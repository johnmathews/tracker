"""The MCP endpoint at /api/mcp: the SDK server, its token check, and the tools (docs/api.md §3.1).

`build_mcp` returns the server and the ASGI app that `app.py` routes the exact path to. Every
request is stateless: one JSON-RPC message in, one JSON response out, with the token checked
again each time. Tools are registered in `_add_tools`. A tool finds its account with `caller()`,
and opens the database with `connection(config)`."""

import json
import logging
import sqlite3
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Annotated, TypedDict
from urllib.parse import urlsplit

import anyio.to_thread
from mcp.server import MCPServer
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.provider import AccessToken, TokenVerifier
from mcp.server.auth.settings import AuthSettings
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from mcp_types import ToolAnnotations
from pydantic import Field
from starlette.applications import Starlette
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import auth, edits, insights, oauth
from .config import Config
from .db import connect
from .validate import Mark, Section

MCP_PATH = "/api/mcp"

log = logging.getLogger(__name__)

#: What each token scope may do. A write token may also read.
SCOPES: dict[auth.TokenScope, list[str]] = {"read": ["read"], "write": ["read", "write"]}

READ_ONLY = ToolAnnotations(read_only_hint=True, destructive_hint=False, open_world_hint=False)
#: Adds an item: a second call adds a second one.
ADDING = ToolAnnotations(
    read_only_hint=False, destructive_hint=False, idempotent_hint=False, open_world_hint=False
)
#: Sets a value: a second call with the same arguments changes nothing more.
SETTING = ToolAnnotations(
    read_only_hint=False, destructive_hint=False, idempotent_hint=True, open_world_hint=False
)
#: Removes an item. A second call is refused, since the item is gone.
REMOVING = ToolAnnotations(
    read_only_hint=False, destructive_hint=True, idempotent_hint=False, open_world_hint=False
)
NEEDS_WRITE = (
    "scope: this connection is read-only. "
    "To change plans and marks, create a write token in Settings › Connections, "  # noqa: RUF001
    "or reconnect and allow changes."
)
#: A week or date so near the calendar's end that a week around it can't be counted.
OUT_OF_RANGE = "date: a week or date is out of range; use one between 2000 and 2999"


class TrackerAccess(AccessToken):
    """A verified token, personal or OAuth, carrying the account it acts as."""

    user: auth.TokenUser


class VerifierUnavailable(Exception):
    """The token could not be checked: the database failed, not the token. `Unavailable` turns
    it into a 503, since a 401 would tell Claude the connection is gone."""


class Unavailable:
    """Answers 503 `busy` when the token verifier fails. Added with `add_middleware`, so it sits
    inside the SDK app's error handling and outside its authentication, which calls the
    verifier (family-finances 8910878)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        started = False

        async def watch(message: Message) -> None:
            nonlocal started
            started = started or message["type"] == "http.response.start"
            await send(message)

        try:
            await self.app(scope, receive, watch)
        except VerifierUnavailable:
            if started:  # pragma: no cover (the verifier runs before any response)
                raise
            body = json.dumps({"error": "busy"}).encode()
            await send(
                {
                    "type": "http.response.start",
                    "status": 503,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"content-length", str(len(body)).encode()),
                        (b"retry-after", b"5"),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": body})


@contextmanager
def connection(config: Config) -> Iterator[sqlite3.Connection]:
    """A database connection for one tool call, closed after it."""
    conn = connect(config.db_path)
    try:
        yield conn
    finally:
        conn.close()


class Tokens(TokenVerifier):
    """Looks a bearer token up by its prefix (D8), on a worker thread, as REST's sync routes do:
    the lookup may wait for SQLite's write lock.

    - `trk_`, a personal token: `auth.token_user`, for this server's own resource.
    - `tka_`, an OAuth access token: `oauth.access_user`, for the resource its grant was issued
      for, which the SDK then compares with this server's (F5).
    - Anything else is no token: a 401.

    `expires_at` stays None, so the SDK's wall-clock check never runs: both lookups end a token
    on `config.clock` themselves (F9). A lookup that fails raises VerifierUnavailable, a 503."""

    def __init__(self, config: Config, resource: str) -> None:
        self.config = config
        self.resource = resource

    def _lookup(self, token: str) -> tuple[auth.TokenUser, str] | None:
        with connection(self.config) as conn:
            if token.startswith(auth.TOKEN_PREFIX):
                user = auth.token_user(conn, self.config, token)
                return None if user is None else (user, self.resource)
            if token.startswith(oauth.ACCESS_PREFIX):
                access = oauth.access_user(conn, self.config, token)
                if access is None:
                    return None
                user = auth.TokenUser(access.user_id, access.username, access.scope)
                return user, access.resource
            return None

    async def verify_token(self, token: str) -> TrackerAccess | None:
        try:
            found = await anyio.to_thread.run_sync(self._lookup, token)
        except Exception as e:
            log.exception("the MCP token check failed")  # the traceback holds no token
            raise VerifierUnavailable from e
        if found is None:
            return None
        user, resource = found
        # The hash stands in for the token, so no repr of this object can leak it.
        return TrackerAccess(
            token=auth.token_hash(token),
            client_id=f"user-{user.user_id}",
            subject=str(user.user_id),
            scopes=SCOPES[user.scope],
            expires_at=None,
            resource=resource,
            user=user,
        )


def caller() -> auth.TokenUser:
    """The account the current request's token acts as.

    The SDK verifies the token on every HTTP request, and in stateless mode each request is one
    call, so this is never older than the call. PermissionError outside an authenticated request,
    which the SDK's 401 means a tool never sees."""
    access = get_access_token()
    if not isinstance(access, TrackerAccess):
        raise PermissionError("no API token for this request")
    return access.user


@dataclass(frozen=True)
class McpEndpoint:
    server: MCPServer
    #: Serves `MCP_PATH`. Its session manager runs inside the API's lifespan, not this app's.
    app: Starlette


def build_mcp(config: Config, max_body: int) -> McpEndpoint:
    origin = config.public_origin
    resource = origin + MCP_PATH
    server = MCPServer(
        "tracker",
        instructions="A weekly training tracker: exercise, cardio and food plans, and the days "
        "marked against them.",
        token_verifier=Tokens(config, resource),
        # Strings, not AnyHttpUrl(...): that adds a slash to a bare origin, and the issuer must
        # match the authorization server's metadata exactly (F8). The 401's `resource_metadata`
        # is built from `resource_server_url`:
        # {origin}/.well-known/oauth-protected-resource/api/mcp.
        auth=AuthSettings.model_validate(
            {
                "issuer_url": origin,
                "resource_server_url": resource,
                "validate_token_resource": True,
            }
        ),
        # The SDK calls logging.basicConfig at this level. WARNING is Python's own default, so the
        # API logs what it did before, and no per-request INFO line from the SDK.
        log_level="WARNING",
    )
    _add_tools(server, config)
    # nginx forwards `$host`, the public host without a port.
    host = urlsplit(origin).hostname or ""
    app = server.streamable_http_app(
        streamable_http_path=MCP_PATH,
        stateless_http=True,
        json_response=True,
        max_request_body_size=max_body,
        transport_security=TransportSecuritySettings(
            allowed_hosts=[host, "localhost:*", "127.0.0.1:*"],
            allowed_origins=[origin],
        ),
    )
    app.add_middleware(Unavailable)
    return McpEndpoint(server, app)


class WhoAmI(TypedDict):
    email: str
    scope: auth.TokenScope


class WeekSummaryResult(insights.WeekSummary):
    this_week: str
    today: str


class WeeksResult(insights.Weeks):
    this_week: str
    today: str


class ItemHistoryResult(insights.ItemHistory):
    this_week: str
    today: str


class GoalsResult(insights.Goals):
    """`note` is the "My goals" note and `limits` the limits note, each "" when there is none."""

    this_week: str
    today: str


class ConsistencyResult(insights.Consistency):
    """`today` is already in insights' result."""

    this_week: str


SECTION_HELP = (
    "Which tracker: `exercise` (workouts and training, the default), `cardio` (cycling, running "
    "and the like: a duration and a distance, a weekly goal, no daily target) or `diet` (food)."
)
WEEK_HELP = "The week, as its Monday written YYYY-MM-DD. Defaults to the current week."
COUNT_HELP = "How many weeks back to look, this week included: 1 to 26. Defaults to 8."
SectionArg = Annotated[Section, Field(description=SECTION_HELP)]
WeekArg = Annotated[str | None, Field(description=WEEK_HELP)]
CARRIED_HELP = (
    "A change to a week applies to that week and to the later weeks that carry its plan "
    "forward, as in the app. A week with no plan of its own first gets a copy of the plan it "
    "shows (`copied_from`), so the week it was carried from never changes."
)
UNDO_HELP = (
    "The result has the week's items `before` and `after`, in these words and with their notes, "
    "so a change can be undone by hand."
)
ItemIdArg = Annotated[str, Field(description="The item's `id`, from `week_summary` or `goals`.")]
SetsArg = Annotated[int | None, Field(description="Exercises only: sets, 0 to 20 (0 clears).")]
#: A cardio session runs up to a day (validate.MAX_CARDIO_DURATION).
RepsArg = Annotated[
    int | None,
    Field(description="Exercises only: reps a set, 0 to 9999. Giving reps clears `seconds`."),
]
SecondsArg = Annotated[
    int | None,
    Field(
        description="Exercises: seconds a set for a timed exercise, 0 to 3600 (0 clears); giving "
        "seconds sets `reps` to 0. Cardio: the whole session's seconds, 0 to 86400 (1800 is 30 "
        "min; 0 clears)."
    ),
]
PerSideArg = Annotated[bool | None, Field(description="Exercises only: done on each side.")]
WeightArg = Annotated[
    float | None, Field(description="Exercises only: weight in kg, 0 to 500 (0 is bodyweight).")
]
DistanceArg = Annotated[
    float | None, Field(description="Cardio only: distance in km, 0 to 1000 (0 clears).")
]
TimesArg = Annotated[int | None, Field(description="The goal: times a week, 0 to 7.")]
#: What the reads of many items say about their notes.
NOTES_CUT = (
    'Notes are cut at 500 characters, ending in "…"; `item_history` gives an item\'s whole note.'
)
#: K85: the app's Daily goal switch, off, takes the daily targets and the met days away.
DAILY_GOAL_OFF = (
    "While Daily goal is off, `daily_target`, each day's `met` and `days_met` are null: there is "
    "no daily target, so say nothing about met days. Cardio has no daily target ever, so its are "
    "always null; that is not Daily goal turned off."
)
NOTE_HELP = (
    "An item's `note` is the item's own, the same in every week, as on its page in the app: "
    "changing it changes no week's plan. `week_summary`, `weeks` and `goals` cut a note at 500 "
    'characters, ending in "…"; `item_history` gives the whole note: read it there before '
    "writing a note back."
)
NoteArg = Annotated[
    str | None,
    Field(
        description="The item's note in markdown, up to 20,000 characters, the same in every "
        "week; empty clears it. It replaces the whole note: read that with `item_history` "
        "first, since the other reads cut it at 500."
    ),
]
MARK_HELP = (
    "How the day went: `great` (done), `partial` (done in part) or `missed` (tried and "
    "couldn't), each alone (the zigzag) or with `-solid` or `-hatch`, the drawings the app "
    "offers; null clears the day. Exercise and cardio take any of them. A food takes only "
    "`great`, `great-solid` or `great-hatch`."
)
DailyArg = Annotated[int | None, Field(description="1 to 8. Left as it is when not given.")]


def _writing[T](config: Config, write: Callable[[sqlite3.Connection, int], T]) -> T:
    """Run an edits operation for the caller, if their token may write. A read token, and an
    `EditError`, become a ToolError whose text says what to do: `field: message`."""
    user = caller()
    if "write" not in SCOPES[user.scope]:
        raise ToolError(NEEDS_WRITE)
    try:
        with connection(config) as conn:
            return write(conn, user.user_id)
    except edits.EditError as e:
        raise ToolError(str(e)) from e


def _reading[T](config: Config, read: Callable[[sqlite3.Connection, int, date], T]) -> T:
    """Run an insights reader for the caller, with their `today`. An `InsightsError` becomes a
    ToolError, which the SDK reports as `isError: true` with this text: `field: message`, and so
    does a week near the year 1 or 9999 (`OverflowError`). Any other exception is a crash, whose
    text the SDK keeps on the server."""
    user = caller()
    try:
        with connection(config) as conn:
            return read(conn, user.user_id, config.today())
    except insights.InsightsError as e:
        raise ToolError(str(e)) from e
    except OverflowError as e:
        raise ToolError(OUT_OF_RANGE) from e


def _add_tools(server: MCPServer, config: Config) -> None:
    """Every tool the endpoint offers. A sync tool runs on a worker thread, where `caller()` still
    works, since the SDK copies the request's context to it. A tool that reads or writes data
    opens `connection(config)` for the call."""

    @server.tool(
        title="Who am I",
        description="The account this token acts as, and its scope (read or write). Call it to "
        "check the connection.",
        annotations=READ_ONLY,
    )
    def whoami() -> WhoAmI:
        user = caller()
        return {"email": user.username, "scope": user.scope}

    @server.tool(
        title="Week summary",
        description="How one week went: each item's marks against its times-a-week goal, which "
        "goals were met, and which days met the daily target, as the app shows that week. A "
        "cardio item also has its `seconds` and `distance_km` when it has them. "
        f"{DAILY_GOAL_OFF} Call "
        "it first to answer 'how is my training going this week'. A week with no plan of its "
        "own shows the plan it carries forward (`plan_week`), or the defaults (`plan_week` is "
        "null; cardio has none). The result also has `this_week` and `today`, the account's "
        f"current week and date. {NOTES_CUT}",
        annotations=READ_ONLY,
    )
    def week_summary(
        section: SectionArg = "exercise",
        week: Annotated[str | None, Field(description=WEEK_HELP)] = None,
    ) -> WeekSummaryResult:
        this_week = config.this_week()
        out = _reading(
            config,
            lambda c, uid, today: insights.week_summary(c, uid, section, week or this_week, today),
        )
        return {**out, "this_week": this_week, "today": config.today().isoformat()}

    @server.tool(
        title="Weeks",
        description="Several weeks side by side, oldest first, each shaped like `week_summary`: "
        "call it to compare weeks or see a trend over a month or two. At most 26 weeks. Defaults "
        f"to the last 4 weeks ending this week. {NOTES_CUT}",
        annotations=READ_ONLY,
    )
    def weeks(
        section: SectionArg = "exercise",
        start: Annotated[
            str | None,
            Field(
                description="The first week, as its Monday YYYY-MM-DD. Defaults to 3 weeks "
                "before `end`."
            ),
        ] = None,
        end: Annotated[
            str | None,
            Field(
                description="The last week, as its Monday YYYY-MM-DD. Defaults to the current week."
            ),
        ] = None,
    ) -> WeeksResult:
        this_week = config.this_week()
        last = end or this_week

        def read(c: sqlite3.Connection, uid: int, today: date) -> insights.Weeks:
            # Three weeks before `end`. When `end` is no Monday the reader refuses it by name, so
            # `start` then falls back to a valid week and does not hide that.
            first = (
                start
                or (
                    date.fromisoformat(last if insights.is_monday(last) else this_week)
                    - timedelta(weeks=3)
                ).isoformat()
            )
            return insights.weeks(c, uid, section, first, last, today)

        out = _reading(config, read)
        return {**out, "this_week": this_week, "today": config.today().isoformat()}

    @server.tool(
        title="Item history",
        description="One exercise, cardio item or food over the last weeks: its goal and marks "
        "in each week "
        "that shows it, and whether the goal was met. Call it for 'how are my squats going'. "
        "Get `item_id` from `week_summary` or `goals`. Weeks that do not show the item have "
        "`in_plan` false. `notes` is the item's whole note, uncut (up to 20,000 characters), "
        "where the other reads cut it at 500: read it here before writing a note back.",
        annotations=READ_ONLY,
    )
    def item_history(
        item_id: Annotated[str, Field(description="The item's `id`, from `goals` or a week.")],
        section: SectionArg = "exercise",
        weeks: Annotated[int, Field(description=COUNT_HELP)] = 8,
    ) -> ItemHistoryResult:
        out = _reading(
            config,
            lambda c, uid, today: insights.item_history(c, uid, section, item_id, weeks, today),
        )
        return {**out, "this_week": config.this_week(), "today": config.today().isoformat()}

    @server.tool(
        title="Goals",
        description="What this week asks for: every exercise, cardio item and food with its "
        "times-a-week goal (a cardio item with its `seconds` and `distance_km`), the daily "
        "targets (exercises a day, foods a day), `daily_goal`, the 'My goals' note (`note`) and "
        "the limits note (`limits`: what the person has to work around, such as injuries, "
        "equipment, time or food), each in the person's own words and '' when there is none. "
        "While Daily goal is off, `daily_goal` is false and both daily targets are null: say "
        "nothing about a number a day or met days. Call it for 'what are my goals' or before "
        "comparing progress with them. Always this week's plan, for exercise, cardio and diet. "
        f"Cardio has no daily target. {NOTES_CUT}",
        annotations=READ_ONLY,
    )
    def goals() -> GoalsResult:
        out = _reading(config, insights.goals)
        return {**out, "this_week": config.this_week(), "today": config.today().isoformat()}

    @server.tool(
        title="Consistency",
        description="How steady training has been: the share of days that met the daily target, "
        "the share of weekly goals met in finished weeks, and the current streaks. "
        "While Daily goal is off, and always for cardio, the daily target and every met-day field "
        "are null. Call it for "
        "'am I consistent' or 'how long a streak do I have'. Counts the last weeks, this week "
        "included, up to today.",
        annotations=READ_ONLY,
    )
    def consistency(
        section: SectionArg = "exercise",
        weeks: Annotated[int, Field(description=COUNT_HELP)] = 8,
    ) -> ConsistencyResult:
        out = _reading(
            config, lambda c, uid, today: insights.consistency(c, uid, section, weeks, today)
        )
        return {**out, "this_week": config.this_week()}

    # --- writes: each needs a write token, and changes one thing as the app would ---

    @server.tool(
        title="Add item",
        description="Add an exercise, a cardio item or a food to a week's plan, with a new id. An "
        "exercise counts reps or seconds, not both. A cardio item has `seconds` (the whole "
        "session), `distance_km`, either, both or neither. A new item's goal is 3 times a week "
        f"unless `times_a_week` is given. {CARRIED_HELP} {NOTE_HELP} {UNDO_HELP} Needs a write "
        "token.",
        annotations=ADDING,
    )
    def add_item(
        name: Annotated[str, Field(description="The name, up to 80 characters.")],
        section: SectionArg = "exercise",
        week: WeekArg = None,
        sets: SetsArg = None,
        reps: RepsArg = None,
        seconds: SecondsArg = None,
        per_side: PerSideArg = None,
        weight_kg: WeightArg = None,
        distance_km: DistanceArg = None,
        times_a_week: TimesArg = None,
        note: NoteArg = None,
    ) -> edits.PlanEdit:
        fields = {
            "name": name,
            "sets": sets,
            "reps": reps,
            "seconds": seconds,
            "per_side": per_side,
            "weight_kg": weight_kg,
            "distance_km": distance_km,
            "times_a_week": times_a_week,
            "note": note,
        }
        target = week or config.this_week()
        return _writing(
            config, lambda c, uid: edits.add_item(c, config, uid, section, target, fields)
        )

    @server.tool(
        title="Update item",
        description="Change one exercise, cardio item or food in a week's plan: only the fields "
        "given change, and the item keeps its id and its marks. Use it to rename an item, change "
        "its goal (`times_a_week`), an exercise's sets, reps or weight, a cardio item's seconds "
        f"or distance, or its note. {CARRIED_HELP} "
        f"{NOTE_HELP} A note alone copies no week. {UNDO_HELP} Needs a write token.",
        annotations=SETTING,
    )
    def update_item(
        item_id: ItemIdArg,
        section: SectionArg = "exercise",
        week: WeekArg = None,
        name: Annotated[str | None, Field(description="A new name, up to 80 characters.")] = None,
        sets: SetsArg = None,
        reps: RepsArg = None,
        seconds: SecondsArg = None,
        per_side: PerSideArg = None,
        weight_kg: WeightArg = None,
        distance_km: DistanceArg = None,
        times_a_week: TimesArg = None,
        note: NoteArg = None,
    ) -> edits.PlanEdit:
        fields = {
            "name": name,
            "sets": sets,
            "reps": reps,
            "seconds": seconds,
            "per_side": per_side,
            "weight_kg": weight_kg,
            "distance_km": distance_km,
            "times_a_week": times_a_week,
            "note": note,
        }
        target = week or config.this_week()
        return _writing(
            config,
            lambda c, uid: edits.update_item(c, config, uid, section, target, item_id, fields),
        )

    @server.tool(
        title="Remove item",
        description="Take one exercise, cardio item or food out of a week's plan. Its marks stay "
        "stored but no longer count, as in the app; adding it back gives it a new id. "
        f"{CARRIED_HELP} `item` in the result is the removed item. Needs a write token.",
        annotations=REMOVING,
    )
    def remove_item(
        item_id: ItemIdArg,
        section: SectionArg = "exercise",
        week: WeekArg = None,
    ) -> edits.PlanEdit:
        target = week or config.this_week()
        return _writing(
            config, lambda c, uid: edits.remove_item(c, config, uid, section, target, item_id)
        )

    @server.tool(
        title="Mark day",
        description="Mark how one exercise, cardio item or food went on one date, or clear the "
        "day. The "
        "item must be in that date's week. Marking a week with no plan of its own first gives "
        "it a copy of the plan it shows, as a tick in the app does, so later edits to the "
        "earlier week no longer reach it; later weeks that carry it forward follow it. The "
        "result has the day's mark `before` and `after`. Needs a write token.",
        annotations=SETTING,
    )
    def mark_day(
        item_id: ItemIdArg,
        mark: Annotated[Mark | None, Field(description=MARK_HELP)],
        section: SectionArg = "exercise",
        date: Annotated[
            str | None, Field(description="The day, YYYY-MM-DD. Defaults to today.")
        ] = None,
    ) -> edits.MarkEdit:
        def write(c: sqlite3.Connection, uid: int) -> edits.MarkEdit:
            day = config.today() if date is None else edits.parse_date(date)
            return edits.mark_day(c, config, uid, section, day, item_id, mark)

        return _writing(config, write)

    @server.tool(
        title="Set daily targets",
        description="Set how many exercises a day and how many foods a day make a day count "
        "as met (the app's 'Exercises a day' and 'Foods a day'). Each is 1 to 8; one not given "
        "stays as it is. The result has both targets `before` and `after`, and `daily_goal`. "
        "While Daily goal is off (`daily_goal` false) the numbers are saved but count only once "
        "it is back on, which only the app can do. Cardio has no daily target. Needs a write "
        "token.",
        annotations=SETTING,
    )
    def set_daily_targets(
        exercises_a_day: DailyArg = None,
        foods_a_day: DailyArg = None,
    ) -> edits.TargetsEdit:
        return _writing(
            config,
            lambda c, uid: edits.set_daily_targets(
                c, uid, exercises_a_day=exercises_a_day, foods_a_day=foods_a_day
            ),
        )
