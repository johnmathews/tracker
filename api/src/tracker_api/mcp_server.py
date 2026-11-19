"""The MCP endpoint at /api/mcp: the SDK server, its token check, and the tools (docs/api.md §3.1).

`build_mcp` returns the server and the ASGI app that `app.py` routes the exact path to. Every
request is stateless: one JSON-RPC message in, one JSON response out, with the token checked
again each time. Tools are registered in `_add_tools`. A tool finds its account with `caller()`,
the connection's name with `source()`, and opens the database with `connection(config)`.

The programme tools (docs/specs/2026-11-17-programmes.md §11.3) let an agent write a programme
in the `tracker-programme/1` format, save it to the library, start it, change it and end it. A
change or an end previews first and applies only when it comes back with `confirm` and the
preview's `rev` (P2).
Every change and every mark on a programme tracker records the connection as its source (P5)."""

import json
import logging
import sqlite3
from collections.abc import Callable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Annotated, Any, NotRequired, TypedDict
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

from . import auth, data, edits, insights, oauth
from .config import Config
from .db import connect
from .programme import FORMAT, ProgrammeError, ProgrammeInvalid, programme_schema
from .programme_replay import CHANGE_KEYS, CHANGE_TYPES
from .validate import Mark, Section, Tracker

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
    #: The connection's name, as Settings › Connections lists it: a personal token's own name,  # noqa: RUF003
    #: or the app an OAuth connection was given to ("Claude"). The source of what it changes.
    source: str


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

    def _lookup(self, token: str) -> tuple[auth.TokenUser, str, str] | None:
        with connection(self.config) as conn:
            if token.startswith(auth.TOKEN_PREFIX):
                user = auth.token_user(conn, self.config, token)
                if user is None:
                    return None
                row = conn.execute(
                    "SELECT name FROM api_tokens WHERE token_hash = ?", (auth.token_hash(token),)
                ).fetchone()
                return user, self.resource, _named(row)
            if token.startswith(oauth.ACCESS_PREFIX):
                access = oauth.access_user(conn, self.config, token)
                if access is None:
                    return None
                user = auth.TokenUser(access.user_id, access.username, access.scope)
                row = conn.execute(
                    "SELECT client_name FROM oauth_grants WHERE id = ?", (access.grant_id,)
                ).fetchone()
                return user, access.resource, _named(row)
            return None

    async def verify_token(self, token: str) -> TrackerAccess | None:
        try:
            found = await anyio.to_thread.run_sync(self._lookup, token)
        except Exception as e:
            log.exception("the MCP token check failed")  # the traceback holds no token
            raise VerifierUnavailable from e
        if found is None:
            return None
        user, resource, name = found
        # The hash stands in for the token, so no repr of this object can leak it.
        return TrackerAccess(
            token=auth.token_hash(token),
            client_id=f"user-{user.user_id}",
            subject=str(user.user_id),
            scopes=SCOPES[user.scope],
            expires_at=None,
            resource=resource,
            user=user,
            source=name,
        )


def _named(row: sqlite3.Row | None) -> str:
    """A connection's name from its row, read just after the token was checked."""
    if row is None:  # pragma: no cover (removed between the two reads: still a connection)
        return "a connection"
    return str(row[0])


def caller() -> auth.TokenUser:
    """The account the current request's token acts as.

    The SDK verifies the token on every HTTP request, and in stateless mode each request is one
    call, so this is never older than the call. PermissionError outside an authenticated request,
    which the SDK's 401 means a tool never sees."""
    return _access().user


def source() -> str:
    """The current request's connection by name: what a programme change or mark records."""
    return _access().source


def _access() -> TrackerAccess:
    access = get_access_token()
    if not isinstance(access, TrackerAccess):
        raise PermissionError("no API token for this request")
    return access


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
        instructions="A weekly training tracker: the person's own trackers, each a weekly plan "
        "of items and the days marked against them. " + TRACKERS_HELP + " The other tools take a "
        "tracker's id or name. " + PROGRAMMES_HELP,
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


class TrackerListResult(insights.TrackerList):
    this_week: str
    today: str


class WeekSummaryResult(insights.WeekSummary):
    #: The tracker's id.
    tracker: str
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


class ChangeType(TypedDict):
    type: str
    #: The keys the change takes besides `type`.
    keys: list[str]
    does: str


class ProgrammeFormat(TypedDict):
    format: str
    #: The format's JSON Schema (draft 2020-12), as `GET /api/programme.schema.json` serves it.
    schema: dict[str, Any]
    example: dict[str, Any]
    changes: list[ChangeType]
    notes: list[str]


class RunListed(TypedDict):
    """A run as the state lists it, with its tracker's id and name."""

    tracker: str
    trackerName: str
    programmeId: str | None
    #: The programme's name.
    name: str
    status: str
    week: int | None
    weeks: int
    start: str
    end: str | None
    pausedUntil: str | None
    #: A paused run's first paused day and its reason.
    pausedSince: str | None
    pauseReason: str | None
    rev: str


class ProgrammeList(TypedDict):
    programmes: list[data.ProgrammeSummary]
    runs: list[RunListed]
    this_week: str
    today: str


class ProgrammeRead(TypedDict):
    """One of the two, the other None."""

    programme: data.ProgrammeRecord | None
    #: As `GET /api/runs/{tracker}` gives it, its grid from this week on; its `work` keeps
    #: every week.
    run: dict[str, Any] | None


class ProgrammeSaved(TypedDict):
    programme: data.ProgrammeRecord


class SharedRead(TypedDict):
    """The shared library's summaries, or one shared programme with its document; the other
    None."""

    programmes: list[data.SharedSummary] | None
    programme: data.SharedRecord | None


class ProgrammeStarted(TypedDict):
    tracker: Tracker
    run: dict[str, Any]


class ProgrammeChange(TypedDict):
    """A preview (`preview` true), or the change applied. `stale` says a confirm came with a rev
    that isn't this change's preview on the run as it is, so this is a fresh preview of the change
    sent and nothing changed. `message` says what to do next."""

    preview: bool
    stale: bool
    message: str
    #: The log entry: a preview's as it would be, or the applied one.
    change: dict[str, Any]
    #: A preview's: the rev that confirms this change alone, each cell before and after, the
    #: hand-edits that block it, the activities that end short, and the change it undoes or item
    #: it deletes.
    rev: NotRequired[str]
    cells: NotRequired[list[dict[str, Any]]]
    blocking: NotRequired[list[dict[str, Any]]]
    endsShort: NotRequired[list[dict[str, Any]]]
    undoes: NotRequired[int | None]
    deletes: NotRequired[str | None]
    #: An applied change's run, as `get_programme` gives it.
    run: NotRequired[dict[str, Any]]


class ProgrammeEnd(TypedDict):
    """End programme previewed (`preview` true), or the run ended. `stale` says a confirm came
    with a rev that isn't this end's preview on the run as it is, so this is a fresh preview and
    nothing changed. `message` says what the end does and what to do next."""

    preview: bool
    stale: bool
    message: str
    #: A preview's: the rev that confirms this end alone, and the end: `{from, reason,
    #: lastWeek}`, the Monday of the last week the tracker shows (null for none).
    rev: NotRequired[str]
    end: NotRequired[dict[str, Any]]
    #: An ended run's tracker, with its `endWeek`, and the run, as `get_programme` gives it.
    tracker: NotRequired[Tracker]
    run: NotRequired[dict[str, Any]]


class ProgrammeRestart(TypedDict):
    """A restart previewed (`preview` true), or the new run started. `stale` says a confirm came
    with a rev that isn't this restart's preview as things are now, so this is a fresh preview and
    nothing changed. `message` says what the restart does and what to do next."""

    preview: bool
    stale: bool
    message: str
    #: A preview's: the rev that confirms this restart alone, and the restart: `{name, start,
    #: firstWeek: {from, to}, weeks, end, oldEndsFrom}`, `oldEndsFrom` null when the old run has
    #: ended by the start.
    rev: NotRequired[str]
    restart: NotRequired[dict[str, Any]]
    #: A restart's new tracker and its run, as `get_programme` gives it, and the old tracker.
    tracker: NotRequired[Tracker]
    run: NotRequired[dict[str, Any]]
    old: NotRequired[Tracker]


class ProgrammeReopen(TypedDict):
    """A re-open previewed (`preview` true), or the run re-opened. `stale` says a confirm came
    with a rev that isn't this re-open's preview on the run as it is, so this is a fresh preview
    and nothing changed. `message` says what the re-open does and what to do next."""

    preview: bool
    stale: bool
    message: str
    #: A preview's: the rev that confirms this re-open alone, and the re-open: `{from, reason,
    #: week, paused: {from, to} | null, end, lastWeek}`.
    rev: NotRequired[str]
    reopen: NotRequired[dict[str, Any]]
    #: A re-opened run's tracker, with its `endWeek`, and the run, as `get_programme` gives it.
    tracker: NotRequired[Tracker]
    run: NotRequired[dict[str, Any]]


#: The tracker a tool acts on when it is given none: the account's first strength tracker, the
#: one every tool acted on before trackers were the account's own.
DEFAULT_TRACKER = "exercise"
TRACKER_HELP = (
    "Which tracker: its `id`, or its name in any case, as `list_trackers` gives them. Defaults "
    "to `exercise`, the first Strength tracker."
)
SECTION_HELP = (
    "The old name for `tracker`, kept so older clients keep working: `exercise`, `cardio` or "
    "`diet`. Give `tracker` instead."
)
WEEK_HELP = "The week, as its Monday written YYYY-MM-DD. Defaults to the current week."
COUNT_HELP = "How many weeks back to look, this week included: 1 to 26. Defaults to 8."
TrackerArg = Annotated[str | None, Field(description=TRACKER_HELP)]
SectionArg = Annotated[Section | None, Field(description=SECTION_HELP)]
WeekArg = Annotated[str | None, Field(description=WEEK_HELP)]
#: What each tool that takes a tracker says about the weeks it shows in (spec §2).
SHOWN_HELP = (
    "A tracker shows from the week it was created in up to the week it was deleted from; a "
    "week it doesn't show in is refused."
)
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
SetsArg = Annotated[
    int | None, Field(description="Strength and mobility only: sets, 0 to 20 (0 clears).")
]
#: A cardio session runs up to a day (validate.MAX_CARDIO_DURATION).
RepsArg = Annotated[
    int | None,
    Field(
        description="Strength and mobility only: reps a set, 0 to 9999. Giving reps clears "
        "`seconds`."
    ),
]
SecondsArg = Annotated[
    int | None,
    Field(
        description="Strength and mobility: seconds a set for a timed exercise or a hold, 0 to "
        "3600 (0 clears); giving seconds sets `reps` to 0. Cardio: the whole session's "
        "seconds, 0 to 86400 (1800 is 30 min; 0 clears)."
    ),
]
PerSideArg = Annotated[
    bool | None, Field(description="Strength and mobility only: done on each side.")
]
WeightArg = Annotated[
    float | None,
    Field(
        description="Strength trackers only: weight in kg, 0 to 500 (0 is bodyweight). A "
        "mobility item has no weight."
    ),
]
DistanceArg = Annotated[
    float | None, Field(description="Cardio trackers only: distance in km, 0 to 1000 (0 clears).")
]
TimesArg = Annotated[int | None, Field(description="The goal: times a week, 0 to 7.")]
#: What the reads of many items say about their notes.
NOTES_CUT = (
    'Notes are cut at 500 characters, ending in "…"; `item_history` gives an item\'s whole note.'
)
#: K85: the app's Daily goal switch, off, takes the daily targets and the met days away.
DAILY_GOAL_OFF = (
    "While Daily goal is off, `daily_target`, each day's `met` and `days_met` are null: there is "
    "no daily target, so say nothing about met days. A cardio tracker has no daily target ever, "
    "so its are always null; that is not Daily goal turned off."
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
    "How the day went: `great` (done), `partial` (done in part) or `missed` (too "
    "difficult), each alone (the zigzag) or with `-solid` or `-hatch`, the drawings the app "
    "offers; null clears the day. Strength, cardio and mobility trackers take any of them. A "
    "food takes "
    "only `great`, `great-solid` or `great-hatch`."
)
DailyArg = Annotated[int | None, Field(description="1 to 8. Left as it is when not given.")]
#: What the instructions and each tool say a tracker is.
TRACKERS_HELP = (
    "The person keeps their own trackers, each with an id, a name and a kind: `strength` "
    "(exercises with sets, reps or seconds, and weight), `cardio` (sessions with a time and a "
    "distance, and no daily target), `food` (foods eaten) or `mobility` (stretches and holds "
    "with sets, reps or seconds, and no weight). Call `list_trackers` to see them."
)
#: What the instructions say about programmes (programmes spec §11.3).
PROGRAMMES_HELP = (
    "A programme is a plan of several weeks, written as a JSON document: call "
    "`programme_format` for its schema and a worked example, write the document, and send it to "
    "`save_programme`, which checks it, lists every problem to fix, and adds it to the person's "
    "library. `start_programme` starts it as a tracker of its own. A programme tracker's plan "
    "comes from its programme: change it with `change_programme`, which shows a preview before "
    "anything changes, never with `add_item`, `update_item` or `remove_item`. End a run early "
    "with `end_programme`, which previews the end first. `restart_programme` starts a run again "
    "from week 1 as a new tracker, after a preview too, and `reopen_programme` carries on a run "
    "End programme stopped, where it stopped. Its days before today are locked, and its marks "
    "stay open for today and yesterday. `list_shared_programmes` lists the shared library, "
    "programmes anyone with an account can copy, and `copy_programme` copies one into the "
    "person's library, to adjust with `save_programme` and start like any other."
)
PROGRAMME_TRACKER_HELP = (
    "A programme tracker's items are refused: its plan comes from its programme, so change it "
    "with `change_programme`."
)

#: The worked example `programme_format` gives: the spec's §3.1 document, the same as
#: fixtures/programmes/valid/spec-example.json, kept here so the package needs no repo file.
EXAMPLE: dict[str, Any] = {
    "format": FORMAT,
    "name": "Beginner 5\u00d75",
    "description": "Three full-body sessions a week, adding weight each week.",
    "kind": "strength",
    "weeks": 8,
    "dailyTarget": 2,
    "params": {
        "squat": {"label": "Squat start", "unit": "kg", "default": 40},
        "rate": {"label": "Weekly increase", "unit": "%", "default": 5},
    },
    "activities": [
        {
            "key": "squat",
            "name": "Back squat",
            "notes": "Belt from week 5.",
            "target": 3,
            "sets": 5,
            "reps": 5,
            "weight": {"start": "$squat", "rate": "$rate", "step": 2.5},
        },
        {
            "key": "plank",
            "name": "Plank",
            "target": 3,
            "sets": 3,
            "duration": {"start": 30, "add": 5, "every": 2, "max": 90},
        },
    ],
    "overrides": [
        {
            "weeks": [4, 8],
            "label": "Deload",
            "activities": {"*": {"sets": 3, "weight": {"scale": 0.9}}},
        }
    ],
}
#: What each type of change does (programmes spec §7; `programme_replay`'s docstring).
CHANGES_DO: dict[str, str] = {
    "pause-programme": "Pauses the whole programme from the day: for `weeks` weeks (1 to 52), or "
    "until a resume-programme when `weeks` is left out.",
    "resume-programme": "Restarts a paused programme at the week it paused on (`at`: "
    '"paused", the default) or the week after ("next").',
    "go-to-week": "Moves the programme to programme week `week` from the day: back, to repeat "
    "weeks, or on, to skip them. A paused activity stays where it is.",
    "pause-activity": "Pauses one activity (`activity`, its key) for `weeks` weeks, or until "
    "resumed. The others carry on, and it resumes where it stopped.",
    "resume-activity": "Restarts a paused activity where it stopped. `values`, such as "
    '{"weight": 70}, sets new values as it comes back.',
    "add-activity": "Adds an activity (`activity`), written as the format writes one, with a key "
    "the programme doesn't have. It starts at its own week 1.",
    "end-activity": "Ends one activity from the day. Past days keep it; one with no past days is "
    "deleted outright.",
    "set-value": "Sets one field (`field`: target, sets, reps, duration, weight or distance) to "
    "`value` from the day on, keeping its increase: from 10 kg to 12.5 kg. The weeks after "
    "continue from the new value.",
    "set-increase": "Sets a progression's increase from the next programme week: `add`, a fixed "
    "amount, or `rate`, a percent a week. It continues from the value shown this week.",
    "set-parameter": "Sets a parameter (`param`, its key) to `value` for every field that uses "
    "it, as set-value or set-increase would.",
    "edit-week": "Sets one field for one programme week only (`week`): a hand-edit. Later "
    "changes keep it, and their previews say so.",
    "undo": "Reverses an earlier change (`change`, its `seq` in the log) whose effect starts "
    "today or later.",
}
assert list(CHANGES_DO) == list(CHANGE_TYPES)
#: How a programme is written, saved, started and changed, for `programme_format`.
FORMAT_NOTES = [
    "Write a document that follows `schema`; `example` is a valid one. Each numeric field is a "
    'number, a parameter ("$squat"), or a progression with `start` and `add` or `rate`.',
    "save_programme checks a document and gives every problem with its path; fix them all and "
    "send the whole document again. With `programme` and `rev` it replaces that programme.",
    "start_programme starts a library programme as a new tracker, from a date today or later, "
    "with values for its parameters. The run keeps its own copy of the document.",
    "change_programme takes one change, below, from a day today or later. It previews first: "
    "show the person what the change does, then send the same change with confirm true and "
    "the preview's rev.",
    "set-value, set-increase, set-parameter and resume-activity also take `dropHandEdits`: the "
    "seqs of the hand-edits a preview says block it, dropped with the change.",
    "end_programme ends a run from a day today or later, keeping its marks, weeks and log. It "
    "previews first too: show the person, then send the same call with confirm true and the "
    "preview's rev.",
    "restart_programme starts a run again from week 1 as a new tracker, from the run's own copy "
    "of the programme, ending the old run from that day if it is still going. It previews first "
    "too.",
    "reopen_programme carries on a run End programme stopped part way, at the programme week it "
    "stopped in: the days from the end count as a pause. It previews first too.",
    "Days before today are locked: no change reaches them. Marks stay open for today and "
    "yesterday, and yesterday's is recorded as late.",
]


def _ref(tracker: str | None, section: Section | None) -> str:
    """The tracker a call names: `tracker`, or `section`, its old name, or the default. Both
    given must agree."""
    if tracker is not None and section is not None and tracker != section:
        raise ToolError("tracker: give tracker or section, not both")
    if tracker is not None:
        return tracker
    return section if section is not None else DEFAULT_TRACKER


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


def _when(config: Config) -> data.When:
    """Now and the server's time zone: today, the lock and sealing follow them (spec §2)."""
    return data.When(config.clock(), config.timezone)


def _count(n: int, noun: str) -> str:
    return f"{n} {noun}" if n == 1 else f"{n} {noun}s"


def _problems(
    field: str,
    what: str,
    verb: str,
    errors: Sequence[ProgrammeError],
    paths: Mapping[str, str] | None = None,
) -> ToolError:
    """Every problem, one a line as `path: sentence`, after a line that says nothing was done.
    A path names the argument (`paths` renames the API's), and the document's root is `field`."""

    def where(path: str) -> str:
        return (paths or {}).get(path, path) or field

    lines = "\n".join(f"- {where(e.path)}: {e.message}" for e in errors)
    return ToolError(
        f"{field}: the {what} has {_count(len(errors), 'problem')}, so nothing was {verb}. "
        f"Fix each one and send it again.\n{lines}"
    )


def _json_object(field: str, value: dict[str, Any] | str) -> dict[str, Any]:
    """An argument that is a JSON object. Some agents send one as JSON text: the SDK reads text
    that holds JSON as the object it holds before the tool runs, so text that gets here is none."""
    if isinstance(value, str):
        raise ToolError(f"{field}: is not a JSON object; send the object itself")
    return value


def _upcoming(run: dict[str, Any], today: date) -> dict[str, Any]:
    """A run with its grid's weeks from this one on. The weeks before are history, which
    `weeks` and `week_summary` read."""
    this_week = insights.monday_of(today).isoformat()
    grid = run["grid"]
    weeks = [w for w in grid["weeks"] if w["monday"] >= this_week]
    return {**run, "grid": {**grid, "weeks": weeks}}


def _no_programme(programme_id: str) -> ToolError:
    return ToolError(
        f"programme: no programme {programme_id} in the library; list_programmes lists them"
    )


def _no_shared(shared_id: str) -> ToolError:
    return ToolError(
        f"programme: no programme {shared_id} in the shared library; list_shared_programmes "
        "lists them"
    )


def _library_full(field: str) -> ToolError:
    held = _count(data.MAX_PROGRAMMES, "programme")
    return ToolError(
        f"{field}: the library holds {held}, the most it can; delete one in the app first"
    )


def _not_a_run(tracker: Tracker) -> ToolError:
    return ToolError(
        f"tracker: {tracker['name']} is not a programme tracker; list_programmes lists the runs"
    )


def _unreadable(tracker: Tracker, e: data.RunUnreadable, *, changing: bool) -> ToolError:
    """A stored run that fails to load or replay: logged with its cause, as REST's 500
    `run-unreadable` is, and told to the agent in a sentence it can pass on."""
    log.error("run %s can't be read", e.tracker_id, exc_info=e)
    nothing = ", so nothing was changed" if changing else ""
    return ToolError(
        f"tracker: {tracker['name']}'s programme can't be read right now{nothing}. The fault "
        "is the server's and is logged; the other trackers still answer. Try again later."
    )


QUOTA = "quota: the account is full, so nothing was {}"


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
        title="List trackers",
        description=f"{TRACKERS_HELP} Gives every tracker, deleted ones too, in the week's order: "
        "its `id`, `name`, `kind` and `daily_target` (how many items a day make a met day), the "
        "week it starts in (`start_week`, null for the first three) and the week it was deleted "
        "from (`end_week`, null while it is live), and whether this week shows it "
        "(`shows_this_week`). A deleted tracker's earlier weeks can still be read and changed. "
        f"{DAILY_GOAL_OFF} Call it first to learn the ids the other tools take.",
        annotations=READ_ONLY,
    )
    def list_trackers() -> TrackerListResult:
        out = _reading(config, insights.trackers)
        return {**out, "this_week": config.this_week(), "today": config.today().isoformat()}

    @server.tool(
        title="Week summary",
        description="How one week of one tracker went: each item's marks against its "
        "times-a-week goal, which goals were met, and which days met the daily target, as the "
        "app shows that week. A cardio item also has its `seconds` and `distance_km` when it has "
        f"them. {DAILY_GOAL_OFF} Call it to answer 'how is my training going this week'. A week "
        "with no plan of its own shows the plan it carries forward (`plan_week`), or the "
        "defaults (`plan_week` is null; only the first Strength and Food trackers have any). "
        f"{SHOWN_HELP} The result also has `this_week` and `today`, the account's current week "
        f"and date. {NOTES_CUT}",
        annotations=READ_ONLY,
    )
    def week_summary(
        tracker: TrackerArg = None,
        week: WeekArg = None,
        section: SectionArg = None,
    ) -> WeekSummaryResult:
        this_week = config.this_week()
        ref = _ref(tracker, section)

        def read(c: sqlite3.Connection, uid: int, today: date) -> tuple[str, insights.WeekSummary]:
            found = insights.tracker_of(c, uid, ref)
            return found["id"], insights.week_summary(c, uid, found["id"], week or this_week, today)

        tracker_id, out = _reading(config, read)
        return {
            **out,
            "tracker": tracker_id,
            "this_week": this_week,
            "today": config.today().isoformat(),
        }

    @server.tool(
        title="Weeks",
        description="Several weeks of one tracker side by side, oldest first, each shaped like "
        "`week_summary`: call it to compare weeks or see a trend over a month or two. At most 26 "
        "weeks. Defaults to the last 4 weeks ending this week. Weeks the tracker doesn't show in "
        f"are left out. {NOTES_CUT}",
        annotations=READ_ONLY,
    )
    def weeks(
        tracker: TrackerArg = None,
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
        section: SectionArg = None,
    ) -> WeeksResult:
        this_week = config.this_week()
        last = end or this_week
        ref = _ref(tracker, section)

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
            return insights.weeks(c, uid, ref, first, last, today)

        out = _reading(config, read)
        return {**out, "this_week": this_week, "today": config.today().isoformat()}

    @server.tool(
        title="Item history",
        description="One item of one tracker over the last weeks: its goal and marks in each "
        "week that shows it, and whether the goal was met. Call it for 'how are my squats "
        "going'. Get `item_id` from `week_summary` or `goals`. Weeks that do not show the item, "
        "or not the tracker, have `in_plan` false. `notes` is the item's whole note, uncut (up "
        "to 20,000 characters), where the other reads cut it at 500: read it here before "
        "writing a note back.",
        annotations=READ_ONLY,
    )
    def item_history(
        item_id: Annotated[str, Field(description="The item's `id`, from `goals` or a week.")],
        tracker: TrackerArg = None,
        weeks: Annotated[int, Field(description=COUNT_HELP)] = 8,
        section: SectionArg = None,
    ) -> ItemHistoryResult:
        ref = _ref(tracker, section)
        out = _reading(
            config,
            lambda c, uid, today: insights.item_history(c, uid, ref, item_id, weeks, today),
        )
        return {**out, "this_week": config.this_week(), "today": config.today().isoformat()}

    @server.tool(
        title="Goals",
        description="What this week asks for, per tracker this week shows (`trackers`, in the "
        "week's order): each tracker's `id`, `name`, `kind` and `daily_target`, and its items "
        "with their times-a-week goals (a cardio item with its `seconds` and `distance_km`). "
        "Then `daily_goal`, the 'My goals' note (`note`) and the limits note (`limits`: what the "
        "person has to work around, such as injuries, equipment, time or food), each in the "
        "person's own words and '' when there is none. While Daily goal is off, `daily_goal` is "
        "false and every daily target is null: say nothing about a number a day or met days. "
        "Call it for 'what are my goals' or before comparing progress with them. Always this "
        f"week's plan. A cardio tracker has no daily target. {NOTES_CUT}",
        annotations=READ_ONLY,
    )
    def goals() -> GoalsResult:
        out = _reading(config, insights.goals)
        return {**out, "this_week": config.this_week(), "today": config.today().isoformat()}

    @server.tool(
        title="Consistency",
        description="How steady one tracker has been: the share of days that met the daily "
        "target, the share of weekly goals met in finished weeks, and the current streaks. "
        "While Daily goal is off, and always for a cardio tracker, the daily target and every "
        "met-day field are null. Call it for 'am I consistent' or 'how long a streak do I "
        "have'. Counts the last weeks, this week included, up to today; weeks the tracker "
        "doesn't show in don't count.",
        annotations=READ_ONLY,
    )
    def consistency(
        tracker: TrackerArg = None,
        weeks: Annotated[int, Field(description=COUNT_HELP)] = 8,
        section: SectionArg = None,
    ) -> ConsistencyResult:
        ref = _ref(tracker, section)
        out = _reading(
            config, lambda c, uid, today: insights.consistency(c, uid, ref, weeks, today)
        )
        return {**out, "this_week": config.this_week()}

    # --- programmes: the format, the library and the runs (programmes spec §11.3) ---

    @server.tool(
        title="Programme format",
        description="How to write a programme: a plan of several weeks as a JSON document in the "
        f"`{FORMAT}` format. Gives the format's JSON Schema (`schema`), a worked example "
        "(`example`), each type of change `change_programme` takes (`changes`, with the keys "
        "each takes and what it does), and short `notes` on saving, starting and changing one. "
        "Call it before writing a programme for `save_programme`.",
        annotations=READ_ONLY,
    )
    def programme_format() -> ProgrammeFormat:
        return {
            "format": FORMAT,
            "schema": programme_schema(),
            "example": EXAMPLE,
            "changes": [
                {"type": kind, "keys": list(CHANGE_KEYS[kind]), "does": CHANGES_DO[kind]}
                for kind in CHANGE_TYPES
            ],
            "notes": FORMAT_NOTES,
        }

    @server.tool(
        title="List programmes",
        description="The person's programme library (`programmes`: each one's `id`, `name`, "
        "`kind`, `weeks`, number of `activities` and `rev`, without the document) and every run "
        "(`runs`: each programme tracker's id and name, the programme, its `status` (upcoming, "
        "running, paused or ended), this programme `week` of `weeks`, its `start` and `end`, "
        "and, while paused, `pausedSince`, `pausedUntil` and `pauseReason`). The result also has "
        "`this_week` and `today`.",
        annotations=READ_ONLY,
    )
    def list_programmes() -> ProgrammeList:
        def read(c: sqlite3.Connection, uid: int, today: date) -> ProgrammeList:
            summaries = data.run_summaries(c, uid, _when(config))
            runs: list[RunListed] = [
                {"tracker": t["id"], "trackerName": t["name"], **summaries[t["id"]]}  # type: ignore[typeddict-item]
                for t in data.load_trackers(c, uid)
                if t["id"] in summaries
            ]
            return {
                "programmes": data.list_programmes(c, uid),
                "runs": runs,
                "this_week": insights.monday_of(today).isoformat(),
                "today": today.isoformat(),
            }

        return _reading(config, read)

    @server.tool(
        title="Get programme",
        description="One programme: give `programme`, a library programme's id, for its "
        "document (`doc`) and `rev`; or `tracker`, a programme tracker's id or name, for its "
        "run: the programme's copy (`doc`), the `params` in force, its `status`, this "
        "programme `week` of `weeks`, `clock` (today's programme week and each activity's "
        "state and activity week), `log` (every change, newest first: when it was made, the "
        "day it took effect, the change, the reason and who made it), `endsShort`, `grid`, "
        "the weeks from this one on with each activity's values, and `work`, every week's "
        "work planned and done from the first week: `total` in kg over the weighted "
        "activities (null when none has weight; `leftOut` names the others), and each "
        "activity's own, in its `measure` (work in kg, reps, seconds, distance in km or time "
        "in min). Any mark counts a session in full; `done` is null for a week to come. Read a "
        "run before changing it, and its log to explain why a value changed.",
        annotations=READ_ONLY,
    )
    def get_programme(
        programme: Annotated[
            str | None, Field(description="A library programme's id, from list_programmes.")
        ] = None,
        tracker: Annotated[
            str | None,
            Field(description="A programme tracker's id, or its name in any case."),
        ] = None,
    ) -> ProgrammeRead:
        if (programme is None) == (tracker is None):
            raise ToolError(
                "programme: give programme (a library id) or tracker (a running one), not both"
            )

        def read(c: sqlite3.Connection, uid: int, today: date) -> ProgrammeRead:
            if programme is not None:
                record = data.load_programme(c, uid, programme)
                if record is None:
                    raise _no_programme(programme)
                return {"programme": record, "run": None}
            found = insights.tracker_of(c, uid, tracker)
            when = _when(config)
            try:
                run = data.read_run(c, uid, found["id"], when)
            except data.RunUnreadable as e:
                raise _unreadable(found, e, changing=False) from None
            if run is None:
                raise _not_a_run(found)
            return {"programme": None, "run": _upcoming(run, when.today)}

        return _reading(config, read)

    @server.tool(
        title="List shared programmes",
        description="The shared library: programmes anyone with an account can copy into their "
        "own library, which an admin publishes in the app. Without `programme`, `programmes` "
        "lists each one's `id`, `name`, `description`, `kind`, `weeks`, number of `activities` "
        "and `updatedAt`, the newest first. With `programme`, a shared programme's id, "
        "`programme` is that one with its document (`doc`). `copy_programme` copies one into "
        "the person's library.",
        annotations=READ_ONLY,
    )
    def list_shared_programmes(
        programme: Annotated[
            str | None,
            Field(description="A shared programme's id, from list_shared_programmes."),
        ] = None,
    ) -> SharedRead:
        def read(c: sqlite3.Connection, uid: int, today: date) -> SharedRead:
            if programme is None:
                return {"programmes": data.list_shared(c), "programme": None}
            found = data.load_shared(c, programme)
            if found is None:
                raise _no_shared(programme)
            return {"programmes": None, "programme": found}

        return _reading(config, read)

    # --- writes: each needs a write token, and changes one thing as the app would ---

    @server.tool(
        title="Add item",
        description="Add an item to a week's plan in one tracker, with a new id: an exercise to "
        "a strength or mobility tracker, a session to a cardio tracker, a food to a food "
        "tracker. An exercise counts reps or seconds, not both, and a mobility item has no "
        "weight. A cardio item has `seconds` (the whole "
        "session), `distance_km`, either, both or neither. A new item's goal is 3 times a week "
        f"unless `times_a_week` is given. {SHOWN_HELP} {CARRIED_HELP} {NOTE_HELP} {UNDO_HELP} "
        f"{PROGRAMME_TRACKER_HELP} Needs a write token.",
        annotations=ADDING,
    )
    def add_item(
        name: Annotated[str, Field(description="The name, up to 80 characters.")],
        tracker: TrackerArg = None,
        week: WeekArg = None,
        sets: SetsArg = None,
        reps: RepsArg = None,
        seconds: SecondsArg = None,
        per_side: PerSideArg = None,
        weight_kg: WeightArg = None,
        distance_km: DistanceArg = None,
        times_a_week: TimesArg = None,
        note: NoteArg = None,
        section: SectionArg = None,
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
        ref, target = _ref(tracker, section), week or config.this_week()
        return _writing(config, lambda c, uid: edits.add_item(c, config, uid, ref, target, fields))

    @server.tool(
        title="Update item",
        description="Change one item in a week's plan: only the fields given change, and the "
        "item keeps its id and its marks. Use it to rename an item, change its goal "
        "(`times_a_week`), an exercise's sets, reps or weight, a cardio item's seconds or "
        f"distance, or its note. {SHOWN_HELP} {CARRIED_HELP} "
        f"{NOTE_HELP} A note alone copies no week. {UNDO_HELP} {PROGRAMME_TRACKER_HELP} A note "
        "alone is still taken there, since it changes no plan. Needs a write token.",
        annotations=SETTING,
    )
    def update_item(
        item_id: ItemIdArg,
        tracker: TrackerArg = None,
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
        section: SectionArg = None,
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
        ref, target = _ref(tracker, section), week or config.this_week()
        return _writing(
            config,
            lambda c, uid: edits.update_item(c, config, uid, ref, target, item_id, fields),
        )

    @server.tool(
        title="Remove item",
        description="Take one item out of a week's plan. Its marks stay stored but no longer "
        f"count, as in the app; adding it back gives it a new id. {SHOWN_HELP} {CARRIED_HELP} "
        f"`item` in the result is the removed item. {PROGRAMME_TRACKER_HELP} Needs a write "
        "token.",
        annotations=REMOVING,
    )
    def remove_item(
        item_id: ItemIdArg,
        tracker: TrackerArg = None,
        week: WeekArg = None,
        section: SectionArg = None,
    ) -> edits.PlanEdit:
        ref, target = _ref(tracker, section), week or config.this_week()
        return _writing(
            config, lambda c, uid: edits.remove_item(c, config, uid, ref, target, item_id)
        )

    @server.tool(
        title="Mark day",
        description="Mark how one item went on one date, or clear the day. The item must be in "
        "that date's week, and the week must show the tracker. Marking a week with no plan of "
        "its own first gives it a copy of the plan it shows, as a tick in the app does, so "
        "later edits to the earlier week no longer reach it; later weeks that carry it forward "
        "follow it. The result has the day's mark `before` and `after`. On a programme tracker "
        "only today and yesterday can be marked: an earlier day is locked, and yesterday's mark "
        "is recorded as late (`late`, in the result only there). Needs a write token.",
        annotations=SETTING,
    )
    def mark_day(
        item_id: ItemIdArg,
        mark: Annotated[Mark | None, Field(description=MARK_HELP)],
        tracker: TrackerArg = None,
        date: Annotated[
            str | None, Field(description="The day, YYYY-MM-DD. Defaults to today.")
        ] = None,
        section: SectionArg = None,
    ) -> edits.MarkEdit:
        ref = _ref(tracker, section)

        def write(c: sqlite3.Connection, uid: int) -> edits.MarkEdit:
            day = config.today() if date is None else edits.parse_date(date)
            return edits.mark_day(c, config, uid, ref, day, item_id, mark, source=who)

        who = source()

        return _writing(config, write)

    @server.tool(
        title="Set daily targets",
        description="Set how many items a day make a day count as met, for one strength, food or "
        "mobility "
        "tracker: give `tracker` and `daily_target`, 1 to 8. The older form still works: "
        "`exercises_a_day` sets the `exercise` tracker's and `foods_a_day` the `diet` "
        "tracker's. The result has each target `before` and `after`, and `daily_goal`. While "
        "Daily goal is off (`daily_goal` false) the numbers are saved but count only once it is "
        "back on, which only the app can do. A cardio tracker has no daily target. Needs a "
        "write token.",
        annotations=SETTING,
    )
    def set_daily_targets(
        tracker: Annotated[
            str | None,
            Field(
                description="Which tracker: its `id`, or its name in any case, as "
                "`list_trackers` gives them. Give `daily_target` with it."
            ),
        ] = None,
        daily_target: DailyArg = None,
        exercises_a_day: Annotated[
            int | None,
            Field(description="The older form: the `exercise` tracker's daily target, 1 to 8."),
        ] = None,
        foods_a_day: Annotated[
            int | None,
            Field(description="The older form: the `diet` tracker's daily target, 1 to 8."),
        ] = None,
    ) -> edits.TargetsEdit:
        if (tracker is None) != (daily_target is None):
            missing = "daily_target" if daily_target is None else "tracker"
            raise ToolError(f"{missing}: give tracker and daily_target together")
        return _writing(
            config,
            lambda c, uid: edits.set_daily_targets(
                c,
                uid,
                None if tracker is None else {tracker: daily_target},
                exercises_a_day=exercises_a_day,
                foods_a_day=foods_a_day,
            ),
        )

    @server.tool(
        title="Save programme",
        description="Check a programme document and add it to the person's library, or, with "
        "`programme` and its `rev`, replace that one. Write the document with "
        "`programme_format`'s schema and example. A document with any problem is never stored: "
        "the error lists every problem, one a line, each with its path in the document and a "
        "sentence, so fix them all and send the whole document again. The result is the stored "
        "programme with its `id` and `rev`; `start_programme` starts it. Runs already started "
        "keep their own copy. Needs a write token.",
        annotations=ADDING,
    )
    def save_programme(
        doc: Annotated[
            dict[str, Any] | str,
            Field(description=f"The programme: a `{FORMAT}` document, as an object."),
        ],
        programme: Annotated[
            str | None,
            Field(description="To replace a library programme: its id. Left out, it is added."),
        ] = None,
        rev: Annotated[
            int | None,
            Field(description="With `programme`: its rev, from list_programmes or get_programme."),
        ] = None,
    ) -> ProgrammeSaved:
        def write(c: sqlite3.Connection, uid: int) -> ProgrammeSaved:
            document = _json_object("doc", doc)
            problems = data.programme_problems(document)
            if problems:
                raise _problems("doc", "programme", "saved", problems)
            try:
                if programme is None:
                    record = data.add_programme(
                        c,
                        uid,
                        document,
                        config.clock(),
                        quota=config.user_quota_bytes,
                        make_id=edits.new_id,
                    )
                    return {"programme": record}
                if rev is None:
                    raise ToolError(
                        "rev: give the programme's rev, from list_programmes or get_programme, "
                        "to replace it"
                    )
                result = data.replace_programme(
                    c, uid, programme, document, rev, config.clock(), quota=config.user_quota_bytes
                )
            except data.TooManyProgrammes:
                raise _library_full("doc") from None
            except data.QuotaExceeded:
                raise ToolError(QUOTA.format("saved")) from None
            if result is None:
                raise _no_programme(programme)
            if isinstance(result, data.ProgrammeConflict):
                raise ToolError(
                    f"rev: the programme changed since rev {rev}; it is at rev "
                    f"{result.programme['rev']} now. Read it with get_programme, then send the "
                    "document again with that rev"
                )
            return {"programme": result.programme}

        return _writing(config, write)

    @server.tool(
        title="Copy programme",
        description="Copy a shared programme, from list_shared_programmes, into the person's "
        "library. The copy is theirs: a new library programme with its own `id`, at rev 1, "
        "with the shared programme's name, and no link back, so later publishes don't change "
        "it. Adjust it with `save_programme` and start it with `start_programme`, as any "
        "library programme. The result is the stored programme. Needs a write token.",
        annotations=ADDING,
    )
    def copy_programme(
        programme: Annotated[
            str, Field(description="The shared programme's id, from list_shared_programmes.")
        ],
    ) -> ProgrammeSaved:
        def write(c: sqlite3.Connection, uid: int) -> ProgrammeSaved:
            try:
                record = data.copy_shared(
                    c,
                    uid,
                    programme,
                    config.clock(),
                    quota=config.user_quota_bytes,
                    make_id=edits.new_id,
                )
            except ProgrammeInvalid as e:
                raise _problems("programme", "programme", "copied", e.errors) from None
            except data.TooManyProgrammes:
                raise _library_full("programme") from None
            except data.QuotaExceeded:
                raise ToolError(QUOTA.format("copied")) from None
            if record is None:
                raise _no_shared(programme)
            return {"programme": record}

        return _writing(config, write)

    @server.tool(
        title="Start programme",
        description="Start a library programme as a new tracker of its kind: a run. It starts "
        "on `start`, today or later (today when left out), with `params`, values for the "
        "programme's parameters (each defaults to the programme's), and the tracker's `name` "
        "(the programme's when left out). Every week of the run is written as the tracker's "
        "plans, so the read tools show them. Problems are listed one a line, each with its "
        "path, and nothing is started. The result is the new tracker and its run, as "
        "`get_programme` gives it. Needs a write token.",
        annotations=ADDING,
    )
    def start_programme(
        programme: Annotated[
            str, Field(description="The library programme's id, from list_programmes.")
        ],
        start: Annotated[
            str | None,
            Field(description="The first day, YYYY-MM-DD, today or later. Defaults to today."),
        ] = None,
        params: Annotated[
            dict[str, Any] | None,
            Field(
                description="A value for each parameter to set, by its key, such as "
                '{"squat": 50}. The others take their defaults.'
            ),
        ] = None,
        name: Annotated[
            str | None,
            Field(
                description="The tracker's name, up to 60 characters. Defaults to the programme's."
            ),
        ] = None,
    ) -> ProgrammeStarted:
        def write(c: sqlite3.Connection, uid: int) -> ProgrammeStarted:
            when = _when(config)
            try:
                started = data.start_programme(
                    c,
                    uid,
                    programme,
                    start=start,
                    params=params,
                    name=name,
                    when=when,
                    quota=config.user_quota_bytes,
                    make_id=edits.new_id,
                )
            except ProgrammeInvalid as e:
                raise _problems("programme", "start", "started", e.errors) from None
            except data.TooManyTrackers:
                raise _too_many_trackers(c, uid) from None
            except data.QuotaExceeded:
                raise ToolError(QUOTA.format("started")) from None
            if started is None:
                raise _no_programme(programme)
            return {"tracker": started.tracker, "run": _upcoming(started.run, when.today)}

        return _writing(config, write)

    @server.tool(
        title="Change programme",
        description="Change a running programme from a day, today or later: pause or resume "
        "it, go to a week, pause, resume, add or end an activity, set a value or an increase, "
        "set a parameter, edit one week, or undo a change. `programme_format` lists each type "
        "of change and its keys. Days before today never change. It previews first: the "
        "result's `cells` give each changed value before and after, `blocking` the hand-edits "
        "that keep their value (send their seqs in `dropHandEdits` to drop them), and "
        "`endsShort` the activities that end before their last week. Show the person the "
        "preview; nothing changes until the same call comes back with `confirm` true and the "
        "preview's `rev`, which confirms that change, date and reason alone (the run's own `rev` "
        "from get_programme confirms nothing). If the programme changed since, or the confirm "
        "differs, the result is a fresh preview with `stale` true, and nothing changed. "
        "Problems are listed one a line, each with its "
        "path. Needs a write token.",
        annotations=SETTING,
    )
    def change_programme(
        tracker: Annotated[
            str, Field(description="The programme tracker's id, or its name in any case.")
        ],
        change: Annotated[
            dict[str, Any] | str,
            Field(
                description="The change, tagged by `type`, such as "
                '{"type": "pause-activity", "activity": "squat", "weeks": 2}.'
            ),
        ],
        from_date: Annotated[
            str | None,
            Field(
                description="The first day it applies, YYYY-MM-DD, today or later. Defaults "
                "to today."
            ),
        ] = None,
        reason: Annotated[
            str | None,
            Field(description="Why, in the person's words, up to 500 characters. Kept in the log."),
        ] = None,
        confirm: Annotated[
            bool, Field(description="True to apply the change previewed with `rev`.")
        ] = False,
        rev: Annotated[
            str | None, Field(description="With `confirm`: the preview's `rev`.")
        ] = None,
    ) -> ProgrammeChange:
        who = source()

        def write(c: sqlite3.Connection, uid: int) -> ProgrammeChange:
            found = edits.find(c, uid, tracker)
            body = _json_object("change", change)
            when = _when(config)
            on = from_date if from_date is not None else when.today.isoformat()
            try:
                out = data.change_run(
                    c,
                    uid,
                    found["id"],
                    body,
                    on,
                    reason=reason,
                    confirm=confirm,
                    rev=rev,
                    when=when,
                    quota=config.user_quota_bytes,
                    source=who,
                )
            except ProgrammeInvalid as e:
                raise _problems(
                    "change", "change", "changed", e.errors, {"from": "from_date"}
                ) from None
            except data.RunEnded:
                raise ToolError(
                    f"tracker: {found['name']} has ended, so its programme takes no more "
                    "changes. restart_programme starts it again as a new run from week 1, and "
                    "reopen_programme carries it on where it stopped"
                ) from None
            except data.StaleRun as e:
                return _previewed(
                    e.preview,
                    stale=True,
                    message="That rev doesn't confirm this change: the programme changed since "
                    "its preview, or the change, its date or its reason isn't the one previewed. "
                    "Nothing was changed. This is the change sent, previewed on the programme as "
                    "it is now: show it, then confirm with this rev.",
                )
            except data.QuotaExceeded:
                raise ToolError(QUOTA.format("changed")) from None
            except data.RunUnreadable as e:
                raise _unreadable(found, e, changing=True) from None
            if out is None:
                raise _not_a_run(found)
            if out["preview"]:
                return _previewed(
                    out,
                    stale=False,
                    message="Nothing has changed yet. Show the person this preview; to apply "
                    "it, call change_programme again with the same arguments, confirm true and "
                    f"rev {out['rev']}.",
                )
            return {
                "preview": False,
                "stale": False,
                "message": f"Changed from {out['change']['from']}.",
                "change": out["change"],
                "run": _upcoming(out["run"], when.today),
            }

        return _writing(config, write)

    @server.tool(
        title="End programme",
        description="End a programme tracker's run from a day, today or later, as End programme "
        "does in the app. The tracker then shows in no week after the one holding the day "
        "before; its marks, weeks, notes and log stay, days from that day on aren't sealed, and "
        "the run takes no more changes. It previews first: the result's `end` gives the from "
        "day, the reason and `lastWeek`, the Monday of the last week the tracker shows. Show the "
        "person the preview; nothing changes until the same call comes back with `confirm` true "
        "and the preview's `rev`, which confirms that day and reason alone. If the programme "
        "changed since, or the confirm differs, the result is a fresh preview with `stale` true, "
        "and nothing changed. Needs a write token.",
        # Like change_programme: it deletes nothing, and a second confirm is refused as ended.
        annotations=SETTING,
    )
    def end_programme(
        tracker: Annotated[
            str, Field(description="The programme tracker's id, or its name in any case.")
        ],
        from_date: Annotated[
            str | None,
            Field(
                description="The first day without the programme, YYYY-MM-DD, today or later. "
                "Defaults to today."
            ),
        ] = None,
        reason: Annotated[
            str | None,
            Field(description="Why, in the person's words, up to 500 characters. Kept in the log."),
        ] = None,
        confirm: Annotated[
            bool, Field(description="True to end it as previewed with `rev`.")
        ] = False,
        rev: Annotated[
            str | None, Field(description="With `confirm`: the preview's `rev`.")
        ] = None,
    ) -> ProgrammeEnd:
        who = source()

        def write(c: sqlite3.Connection, uid: int) -> ProgrammeEnd:
            found = edits.find(c, uid, tracker)
            when = _when(config)
            name = found["name"]
            try:
                if not confirm:
                    preview = data.preview_end(
                        c, uid, found["id"], from_date, reason=reason, when=when
                    )
                    if preview is None:
                        raise _not_a_run(found)
                    return _end_previewed(name, preview, stale=False)
                out = data.end_run(
                    c,
                    uid,
                    found["id"],
                    from_date,
                    reason=reason,
                    when=when,
                    source=who,
                    previewed=True,
                    rev=rev,
                )
            except ProgrammeInvalid as e:
                raise _problems(
                    "tracker", "end", "ended", e.errors, {"from": "from_date"}
                ) from None
            except data.RunEnded:
                raise ToolError(
                    f"tracker: {name} has ended, or already has an end day, so there is nothing "
                    "to end. restart_programme starts it again as a new run from week 1. "
                    "reopen_programme carries on a run that End programme ended."
                ) from None
            except data.StaleRun as e:
                return _end_previewed(name, e.preview, stale=True)
            except data.RunUnreadable as e:
                raise _unreadable(found, e, changing=True) from None
            if out is None:
                raise _not_a_run(found)
            return {
                "preview": False,
                "stale": False,
                "message": f"Ended from {out.run['ended']['from']}.",
                "tracker": out.tracker,
                "run": _upcoming(out.run, when.today),
            }

        return _writing(config, write)

    @server.tool(
        title="Restart programme",
        description="Start a programme tracker's run again from week 1, as a new tracker: from "
        "`start`, today or later (today when left out), named `name` (the old tracker's name when "
        "left out). It starts from the run's own copy of the programme and the parameters the run "
        "started with, so it works after the library programme is edited or deleted. A run still "
        "going on that day ends from it, as end_programme ends one, keeping its marks, weeks, "
        "notes and log. It previews first: the result's `restart` gives the new tracker's name, "
        "its start, week 1's dates (`firstWeek`), its weeks, its last day, and `oldEndsFrom`, the "
        "day the old run ends from (null when it has ended by then). Show the person the preview; "
        "nothing changes until the same call comes back with `confirm` true and the preview's "
        "`rev`. If the programme or the account's trackers changed since, or the confirm differs, "
        "the result is a fresh preview with `stale` true, and nothing changed. Problems are "
        "listed one a line, each with its path. Needs a write token.",
        # Like start_programme: each confirm adds a tracker. The end it may write deletes nothing.
        annotations=ADDING,
    )
    def restart_programme(
        tracker: Annotated[
            str, Field(description="The programme tracker's id, or its name in any case.")
        ],
        start: Annotated[
            str | None,
            Field(
                description="The new run's first day, YYYY-MM-DD, today or later. Defaults to "
                "today."
            ),
        ] = None,
        name: Annotated[
            str | None,
            Field(
                description="The new tracker's name, up to 60 characters. Defaults to the old "
                "tracker's."
            ),
        ] = None,
        confirm: Annotated[
            bool, Field(description="True to restart it as previewed with `rev`.")
        ] = False,
        rev: Annotated[
            str | None, Field(description="With `confirm`: the preview's `rev`.")
        ] = None,
    ) -> ProgrammeRestart:
        who = source()

        def write(c: sqlite3.Connection, uid: int) -> ProgrammeRestart:
            found = edits.find(c, uid, tracker)
            when = _when(config)
            old = found["name"]
            try:
                if not confirm:
                    preview = data.preview_restart(
                        c, uid, found["id"], start=start, name=name, when=when
                    )
                    if preview is None:
                        raise _not_a_run(found)
                    return _restart_previewed(old, preview, stale=False)
                out = data.restart_run(
                    c,
                    uid,
                    found["id"],
                    start=start,
                    name=name,
                    rev=rev,
                    when=when,
                    quota=config.user_quota_bytes,
                    make_id=edits.new_id,
                    source=who,
                )
            except ProgrammeInvalid as e:
                raise _problems("tracker", "restart", "restarted", e.errors) from None
            except data.StaleRun as e:
                return _restart_previewed(old, e.preview, stale=True)
            except data.TooManyTrackers:
                raise _too_many_trackers(c, uid) from None
            except data.QuotaExceeded:
                raise ToolError(QUOTA.format("restarted")) from None
            except data.RunUnreadable as e:
                raise _unreadable(found, e, changing=True) from None
            if out is None:
                raise _not_a_run(found)
            new = out.new
            return {
                "preview": False,
                "stale": False,
                "message": f"Restarted from {new.run['start']}.",
                "tracker": new.tracker,
                "run": _upcoming(new.run, when.today),
                "old": out.old,
            }

        return _writing(config, write)

    @server.tool(
        title="Re-open programme",
        description="Carry on a programme tracker's run that End programme stopped part way, "
        "from a day, today or later and no earlier than the end's own day. The days from the end "
        "to the day before count as a pause of the whole programme, and the run resumes at the "
        "programme week it stopped in. Days before the end stay as they are, and the run takes "
        "changes again. A run that ran to its last week has nothing to re-open: restart_programme "
        "starts it again. Nor has a run a restart ended, since the new run replaces it. It "
        "previews first: the result's `reopen` gives the day, the reason, "
        "`week` (the programme week it resumes at), `paused` (the paused days, null for none), "
        "the run's new last day and `lastWeek`, the Monday of its last week. Show the person the "
        "preview; nothing changes until the same call comes back with `confirm` true and the "
        "preview's `rev`, which confirms that day and reason alone. If the programme changed "
        "since, or the confirm differs, the result is a fresh preview with `stale` true, and "
        "nothing changed. Needs a write token.",
        # Like end_programme: it deletes nothing, and a second confirm is refused as not ended.
        annotations=SETTING,
    )
    def reopen_programme(
        tracker: Annotated[
            str, Field(description="The programme tracker's id, or its name in any case.")
        ],
        from_date: Annotated[
            str | None,
            Field(
                description="The first day the programme runs again, YYYY-MM-DD, today or "
                "later. Defaults to today."
            ),
        ] = None,
        reason: Annotated[
            str | None,
            Field(description="Why, in the person's words, up to 500 characters. Kept in the log."),
        ] = None,
        confirm: Annotated[
            bool, Field(description="True to re-open it as previewed with `rev`.")
        ] = False,
        rev: Annotated[
            str | None, Field(description="With `confirm`: the preview's `rev`.")
        ] = None,
    ) -> ProgrammeReopen:
        who = source()

        def write(c: sqlite3.Connection, uid: int) -> ProgrammeReopen:
            found = edits.find(c, uid, tracker)
            when = _when(config)
            name = found["name"]
            try:
                if not confirm:
                    preview = data.preview_reopen(
                        c, uid, found["id"], from_date, reason=reason, when=when
                    )
                    if preview is None:
                        raise _not_a_run(found)
                    return _reopen_previewed(name, preview, stale=False)
                out = data.reopen_run(
                    c,
                    uid,
                    found["id"],
                    from_date,
                    reason=reason,
                    rev=rev,
                    when=when,
                    quota=config.user_quota_bytes,
                    source=who,
                )
            except ProgrammeInvalid as e:
                raise _problems(
                    "tracker", "re-open", "re-opened", e.errors, {"from": "from_date"}
                ) from None
            except data.CantReopen as e:
                if e.restarted:
                    raise ToolError(
                        f"tracker: {name} was restarted from week 1 as a new tracker, which "
                        "replaces this run, so there is nothing to re-open"
                    ) from None
                raise ToolError(
                    f"tracker: {name} ran to its end, or was ended before it started, so there "
                    "is nothing to re-open. restart_programme starts it again from week 1"
                    if e.finished
                    else f"tracker: {name} hasn't been ended, so there is nothing to re-open"
                ) from None
            except data.StaleRun as e:
                return _reopen_previewed(name, e.preview, stale=True)
            except data.QuotaExceeded:
                raise ToolError(QUOTA.format("re-opened")) from None
            except data.RunUnreadable as e:
                raise _unreadable(found, e, changing=True) from None
            if out is None:
                raise _not_a_run(found)
            return {
                "preview": False,
                "stale": False,
                "message": f"Re-opened from {out.run['log'][0]['from']}.",
                "tracker": out.tracker,
                "run": _upcoming(out.run, when.today),
            }

        return _writing(config, write)


def _reopen_previewed(name: str, preview: dict[str, Any], *, stale: bool) -> ProgrammeReopen:
    """A re-open's preview, with a message that says what it does and how to confirm it: first
    that nothing has changed yet, or for a stale confirm, why nothing changed."""
    reopen = preview["reopen"]
    on, paused, week = reopen["from"], reopen["paused"], reopen["lastWeek"]
    gap = (
        "It re-opens on the day it was to end, so no day is paused."
        if paused is None
        else f"The days from {paused['from']} to {paused['to']} count as a pause of the whole "
        "programme."
    )
    last = (
        "It has no last week while the programme is paused with no end date."
        if week is None
        else f"Its last week is now the week of {week}."
    )
    ended = on if paused is None else paused["from"]
    said = (
        f"{name} re-opens from {on}, at programme week {reopen['week']}. {gap} {last} Days "
        f"before {ended} stay as they are, and the run takes changes again. Show the person this "
        "preview; to re-open it, call reopen_programme again with the same arguments, confirm "
        f"true and rev {preview['rev']}."
    )
    first = (
        "That rev doesn't confirm this re-open: the programme changed since its preview, or its "
        "day or its reason isn't the one previewed. Nothing was changed. This is the re-open "
        "sent, previewed on the programme as it is now."
        if stale
        else "Nothing has changed yet."
    )
    return {
        "preview": True,
        "stale": stale,
        "message": f"{first} {said}",
        "rev": preview["rev"],
        "reopen": reopen,
    }


def _too_many_trackers(conn: sqlite3.Connection, user_id: int) -> ToolError:
    held = len(data.load_trackers(conn, user_id))
    return ToolError(
        f"tracker: the account has {held} trackers, the most it can hold; delete one in the app "
        "first"
    )


def _restart_previewed(old: str, preview: dict[str, Any], *, stale: bool) -> ProgrammeRestart:
    """A restart's preview, with a message that says what it does and how to confirm it: first
    that nothing has changed yet, or for a stale confirm, why nothing changed."""
    restart = preview["restart"]
    start, week = restart["start"], restart["firstWeek"]
    ends = restart["oldEndsFrom"]
    before = date.fromisoformat(ends) - timedelta(days=1) if ends is not None else None
    stops = (
        f"{old}, the run now, has ended. Its marks, weeks, notes and log stay, and the new run "
        "replaces it, so it can't be re-opened."
        if before is None
        else f"{old}, the run now, ends from {ends}, so its last day is {before.isoformat()}. "
        "Its marks, weeks, notes and log stay."
    )
    said = (
        f"{restart['name']} starts again from week 1 on {start}, as a new tracker. Week 1 runs "
        f"{week['from']} to {week['to']}, and the run has {_count(restart['weeks'], 'week')}, to "
        f"{restart['end']}. {stops} Show the person this preview; to restart it, call "
        "restart_programme again with the same arguments, confirm true and rev "
        f"{preview['rev']}."
    )
    first = (
        "That rev doesn't confirm this restart: the programme or the account's trackers changed "
        "since its preview, or its start or its name isn't the one previewed. Nothing was "
        "changed. This is the restart sent, previewed as things are now."
        if stale
        else "Nothing has changed yet."
    )
    return {
        "preview": True,
        "stale": stale,
        "message": f"{first} {said}",
        "rev": preview["rev"],
        "restart": restart,
    }


def _end_previewed(name: str, preview: dict[str, Any], *, stale: bool) -> ProgrammeEnd:
    """End programme's preview, with a message that says what the end does and how to confirm
    it: first that nothing has changed yet, or for a stale confirm, why nothing changed."""
    end = preview["end"]
    on = end["from"]
    week = end["lastWeek"]
    shows = (
        f"{name} then shows in no week."
        if week is None
        else f"Its last week is the week of {week}."
    )
    said = (
        f"{name} ends from {on}. {shows} Its marks, weeks, notes and log stay. Days from {on} on "
        "aren't sealed, and the run takes no more changes. Show the person this preview; to end "
        "it, call end_programme again with the same arguments, confirm true and rev "
        f"{preview['rev']}."
    )
    first = (
        "That rev doesn't confirm this end: the programme changed since its preview, or its day "
        "or its reason isn't the one previewed. Nothing was changed. This is the end sent, "
        "previewed on the programme as it is now."
        if stale
        else "Nothing has changed yet."
    )
    return {
        "preview": True,
        "stale": stale,
        "message": f"{first} {said}",
        "rev": preview["rev"],
        "end": end,
    }


def _previewed(preview: dict[str, Any], *, stale: bool, message: str) -> ProgrammeChange:
    """A change's preview without its grid, which is for the app's overview: `cells` says what
    changes."""
    kept = {k: v for k, v in preview.items() if k != "grid"}
    return {**kept, "stale": stale, "message": message}  # type: ignore[typeddict-item]
