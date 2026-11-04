"""OAuth connections for claude.ai, Claude Code and ChatGPT: clients, consent requests, codes,
refresh rotation with reuse detection, access tokens, and how a connection ends (docs/api.md §4).

The HTTP surface is `oauth_api.py`; this module knows nothing about requests. It ports
family-finances' `oauth.py` without its household-key sealing or its pre-registered client:

- A client is a client ID metadata document (CIMD): an `https://` URL on an allowed host whose
  JSON names itself. `ClientResolver` fetches and checks it.
- `/authorize` holds a pending request for 10 minutes, which the consent screen approves or denies.
- Approval creates a grant, the connection, which ends 90 days later however much it is used, and
  a 60-second code bound to the client, the redirect, the PKCE challenge and the resource.
  Redeeming the code issues the first pair; redeeming it again ends the grant.
- Each refresh rotates both tokens with a compare-and-swap on the grant's generation. For 60
  seconds the replaced refresh token gets the same new pair, sealed under it in the row. After
  that it is retired, and presenting it ends the grant. A token that matches nothing ends
  nothing, so a guess cannot cut a user off; and nothing throttles refreshes, since the secrets
  are 256 random bits.
- An access token lasts an hour, never past its grant.

Codes and tokens are random and stored as SHA-256 only. Security events are logged with the grant
id; a secret never is. Every time is `config.clock`.
"""

import base64
import hashlib
import hmac
import http.client
import json
import logging
import re
import secrets
import sqlite3
import threading
import time
import urllib.error
import urllib.request
from collections import OrderedDict
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from urllib.parse import urlsplit

from .auth import DAY, AuthError, TokenScope, token_hash
from .config import Config
from .db import transaction

log = logging.getLogger(__name__)

#: A connection's whole life, from approval, however much it is used (D3).
GRANT_LIFETIME = 90 * DAY
ACCESS_LIFETIME = 3600
CODE_LIFETIME = 60
#: How long a replaced refresh token still gets the pair that replaced it.
GRACE_SECONDS = 60
#: How long the consent screen has to approve or deny a request (D5).
REQUEST_LIFETIME = 600
#: Pending requests across all clients. `/authorize` needs no sign-in, so this bounds the table.
MAX_REQUESTS = 1000
#: Live connections one user may hold (D6); an approval waiting on its code counts.
MAX_GRANTS = 10
#: A connection approved this recently is marked new in Settings.
NEW_FOR = DAY
#: `last_used_at` moves at most this often on access-token use.
LAST_USED_EVERY = 60

ACCESS_PREFIX = "tka_"
REFRESH_PREFIX = "tkr_"
CODE_PREFIX = "tkc_"

#: Fetching a client's document: seconds in all, bytes at most, good documents kept this long.
FETCH_TIMEOUT = 5.0
MAX_DOCUMENT = 5 * 1024
CACHE_SECONDS = 3600
CACHE_SIZE = 32
MAX_CLIENT_ID = 255
MAX_CLIENT_NAME = 64
LOOPBACK = frozenset({"localhost", "127.0.0.1", "::1"})

_B64_32 = r"[A-Za-z0-9_-]{43}"  # 32 random bytes, base64url without padding
_ACCESS_RE = re.compile(ACCESS_PREFIX + _B64_32)
_CODE_RE = re.compile(CODE_PREFIX + _B64_32)
_REFRESH_RE = re.compile(REFRESH_PREFIX + r"([0-9a-f]{32})\.(" + _B64_32 + ")")
_VERIFIER_RE = re.compile(r"[A-Za-z0-9\-._~]{43,128}")


# ------------------------------------------------------------ results and refusals


class ClientRefused(Exception):
    """A client or redirect this server will not deal with. W4 answers 400 and never redirects.

    `reason`: `client-id` (not an https URL on an allowed host), `unreachable`, `status` (not
    200), `too-large`, `document` (not a JSON object), `client-id-mismatch`, `auth` (it cannot
    sign in without a secret: neither its `token_endpoint_auth_method` nor its
    `token_endpoint_auth_methods_supported` is or holds `none`), `redirect-uris`, `grant-types`,
    `response-types`, or `redirect` (not one of its registered redirects)."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class InvalidGrant(Exception):
    """OAuth's `invalid_grant`, for the token endpoint.

    `reason` says which refusal it was, for logs and tests: `unknown`, `malformed`,
    `code_mismatch`, `reuse`, `client`, `resource`, `expired`, `disabled`, `wrong_secret`,
    `tamper` or `busy`. `ended` says whether it ended a grant."""

    def __init__(
        self, message: str = "invalid grant", *, reason: str = "unknown", ended: bool = False
    ) -> None:
        super().__init__(message)
        self.reason = reason
        self.ended = ended


@dataclass(frozen=True, slots=True)
class Fetched:
    """What a fetch of a client's document got: the status and at most MAX_DOCUMENT + 1 bytes."""

    status: int
    body: bytes


Fetch = Callable[[str], Fetched]


@dataclass(frozen=True, slots=True)
class Client:
    """A client as its metadata document describes it."""

    client_id: str
    #: Its `client_name`, or its host when it has no fit one.
    name: str
    host: str
    redirect_uris: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class PendingRequest:
    """An authorization request waiting on the consent screen."""

    client_id: str
    client_name: str
    client_host: str
    redirect_uri: str
    redirect_host: str
    #: As the client asked, or None; the consent screen's write box decides what is granted.
    scope: str | None
    state: str | None
    resource: str
    expires_at: int


@dataclass(frozen=True, slots=True)
class Approval:
    """Where the consent screen sends the browser: `redirect_uri` with `code` and `state`."""

    code: str
    redirect_uri: str
    state: str | None
    grant_id: str


@dataclass(frozen=True, slots=True)
class Issued:
    """A token response's contents."""

    access_token: str
    refresh_token: str
    expires_in: int
    scope: TokenScope


@dataclass(frozen=True, slots=True)
class AccessUser:
    """Who an access token acts as, for what, and until when."""

    user_id: int
    username: str
    scope: TokenScope
    #: The resource the grant was issued for; the verifier compares it with its own (F5).
    resource: str
    expires_at: int
    grant_id: str


@dataclass(frozen=True, slots=True)
class GrantInfo:
    """A connection as the Connections section of Settings shows it."""

    grant_id: str
    client_id: str
    client_name: str
    client_host: str
    scope: TokenScope
    created_at: int
    last_used_at: int | None
    expires_at: int
    #: Approved within NEW_FOR, on the server's clock.
    is_new: bool


# ------------------------------------------------------------ clients (CIMD)


class _NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: object, **kwargs: object) -> None:
        return None  # urllib then raises the 3xx as an HTTPError


def fetch_document(url: str) -> Fetched:
    """GET a client's metadata document. It follows no redirect, reads at most MAX_DOCUMENT + 1
    bytes, and gives up after FETCH_TIMEOUT seconds in all, however slowly bytes arrive.

    ClientRefused `unreachable` when no answer comes; a non-200 answer is returned as such.
    The resolver checks the URL before it gets here."""
    deadline = time.monotonic() + FETCH_TIMEOUT
    opener = urllib.request.build_opener(_NoRedirects)
    request = urllib.request.Request(  # noqa: S310 (the resolver allows only https URLs)
        url, headers={"Accept": "application/json", "User-Agent": "tracker-oauth/1"}
    )
    try:
        with opener.open(request, timeout=FETCH_TIMEOUT) as response:
            body = b""
            while len(body) <= MAX_DOCUMENT:
                if time.monotonic() > deadline:
                    raise ClientRefused("unreachable")
                chunk = response.read1(MAX_DOCUMENT + 1 - len(body))
                if not chunk:
                    break
                body += chunk
            return Fetched(int(response.status), body)
    except urllib.error.HTTPError as e:
        e.close()
        return Fetched(e.code, b"")
    except (OSError, http.client.HTTPException, ValueError) as e:  # URLError is an OSError
        raise ClientRefused("unreachable") from e


def _strings(value: object) -> list[str] | None:
    if isinstance(value, list) and all(isinstance(v, str) for v in value):
        return value
    return None


def _can_use_none(document: dict[str, object]) -> bool:
    """Whether the client can sign in as a public client: no secret, PKCE only, the one method
    this server accepts. RFC 7591's singular `token_endpoint_auth_method` says so when it is
    `none`. A document may also list every method it can use in
    `token_endpoint_auth_methods_supported` (MCP SEP-3149), and the singular is then only a
    preference: ChatGPT's prefers `private_key_jwt` and lists `none` too. A list that holds
    `none` is enough; a list that is not a list of strings is refused."""
    if document.get("token_endpoint_auth_method") == "none":
        return True
    listed = _strings(document.get("token_endpoint_auth_methods_supported"))
    return listed is not None and "none" in listed


def _client_from(client_id: str, host: str, fetched: Fetched) -> Client:
    if fetched.status != 200:
        raise ClientRefused("status")
    if len(fetched.body) > MAX_DOCUMENT:
        raise ClientRefused("too-large")
    try:
        document = json.loads(fetched.body)
    except ValueError:  # UnicodeDecodeError is one
        raise ClientRefused("document") from None
    if not isinstance(document, dict):
        raise ClientRefused("document")
    if document.get("client_id") != client_id:
        raise ClientRefused("client-id-mismatch")
    if not _can_use_none(document):
        raise ClientRefused("auth")
    # Only https, or http to this computer (RFC 8252): the consent screen sends the browser to the
    # redirect, so a `javascript:` or `data:` entry must never be one.
    listed = _strings(document.get("redirect_uris")) or []
    redirects = [uri for uri in listed if _safe_redirect(uri)]
    if not redirects:
        raise ClientRefused("redirect-uris")
    # Absent lists take RFC 7591's defaults; extra grant types (Claude's jwt-bearer) are fine.
    grant_types = _strings(document.get("grant_types", ["authorization_code"]))
    if grant_types is None or "authorization_code" not in grant_types:
        raise ClientRefused("grant-types")
    response_types = _strings(document.get("response_types", ["code"]))
    if response_types is None or "code" not in response_types:
        raise ClientRefused("response-types")
    name = document.get("client_name")
    name = name.strip() if isinstance(name, str) else ""
    if not 1 <= len(name) <= MAX_CLIENT_NAME or not name.isprintable():
        name = host
    return Client(client_id, name, host, tuple(redirects))


class ClientResolver:
    """Resolves a `client_id` URL to its client, on `hosts` only (exact host names).

    Good documents are cached in memory for CACHE_SECONDS on `clock`, at most CACHE_SIZE of them;
    a refusal is never cached. One instance serves the app; it is thread-safe, and no lock is
    held while fetching."""

    def __init__(
        self, hosts: Iterable[str], clock: Callable[[], int], fetch: Fetch = fetch_document
    ) -> None:
        self._hosts = frozenset(h.lower() for h in hosts)
        self._clock = clock
        self._fetch = fetch
        self._cache: OrderedDict[str, tuple[int, Client]] = OrderedDict()
        self._lock = threading.Lock()

    def _host(self, client_id: str) -> str:
        """The client's host, if `client_id` is an https URL on an allowed host with a path and
        nothing else: no port, user, query, fragment or dot segment. ClientRefused `client-id`."""
        if (
            not isinstance(client_id, str)
            or len(client_id) > MAX_CLIENT_ID
            or not client_id.isprintable()
            or any(c in client_id for c in " ?#")
        ):
            raise ClientRefused("client-id")
        url = urlsplit(client_id)
        host = url.hostname or ""
        segments = url.path.split("/")
        if (
            url.scheme != "https"
            or host not in self._hosts
            or url.netloc != host  # a port, a user, or a host not in lower case
            or len(url.path) < 2
            or "." in segments
            or ".." in segments
        ):
            raise ClientRefused("client-id")
        return host

    def resolve(self, client_id: str) -> Client:
        """The client `client_id` names, fetched or cached. ClientRefused if it is not one."""
        host = self._host(client_id)
        now = self._clock()
        with self._lock:
            hit = self._cache.get(client_id)
            if hit is not None and now - hit[0] < CACHE_SECONDS:
                return hit[1]
        client = _client_from(client_id, host, self._fetch(client_id))
        with self._lock:
            self._cache[client_id] = (now, client)
            self._cache.move_to_end(client_id)
            while len(self._cache) > CACHE_SIZE:
                self._cache.popitem(last=False)
        return client

    def check(self, client_id: str, redirect_uri: str) -> Client:
        """The client, if `redirect_uri` is one of its own; ClientRefused otherwise."""
        client = self.resolve(client_id)
        if not redirect_allowed(client, redirect_uri):
            raise ClientRefused("redirect")
        return client


def _loopback(uri: str) -> tuple[str, str, str] | None:
    """(host, path, query) of a plain `http://` loopback URI, or None for anything else."""
    try:
        url = urlsplit(uri)
        url.port  # noqa: B018 (raises ValueError on a port out of range)
    except ValueError:
        return None
    if (
        url.scheme != "http"
        or url.hostname not in LOOPBACK
        or url.username is not None
        or url.fragment
    ):
        return None
    return url.hostname, url.path, url.query


def _safe_redirect(uri: str) -> bool:
    """An `https://` URI with a host, or a plain `http://` loopback one."""
    if _loopback(uri) is not None:
        return True
    try:
        url = urlsplit(uri)
    except ValueError:
        return False
    return url.scheme == "https" and bool(url.hostname)


def redirect_allowed(client: Client, redirect_uri: str) -> bool:
    """Whether `redirect_uri` is one of the client's: an exact member of its `redirect_uris`, or
    a loopback one matching a registered loopback one on any port (RFC 8252 §7.3, for Claude
    Code's local callback)."""
    if (
        not isinstance(redirect_uri, str)
        or not redirect_uri.isprintable()
        or " " in redirect_uri
        or "#" in redirect_uri
    ):
        return False
    if redirect_uri in client.redirect_uris:
        return True
    target = _loopback(redirect_uri)
    return target is not None and any(_loopback(r) == target for r in client.redirect_uris)


# ------------------------------------------------------------ secrets


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _access_token(raw: bytes) -> str:
    return ACCESS_PREFIX + _b64(raw)


def _refresh_token(grant_id: str, raw: bytes) -> str:
    """The grant id travels in the token, so a wrong secret can be logged against its grant."""
    return f"{REFRESH_PREFIX}{grant_id}.{_b64(raw)}"


def _parse_refresh(token: object) -> tuple[str, bytes] | None:
    if not isinstance(token, str):
        return None
    match = _REFRESH_RE.fullmatch(token)
    return None if match is None else (match[1], _unb64(match[2]))


def _seal(pair: bytes, secret: bytes, grant_id: str, generation: int) -> bytes:
    """The new access and refresh secrets (64 bytes) XORed with a pad that only the refresh token
    they replaced can make. Sealing twice opens. The pad is HMAC-SHA512 keyed by that token's
    32 secret bytes, which the database never holds (it holds the SHA-256 of the whole token),
    and bound to the grant and generation, so each pad is used once."""
    pad = hmac.new(secret, f"tracker-oauth-grace/{grant_id}/{generation}".encode(), "sha512")
    return bytes(a ^ b for a, b in zip(pair, pad.digest(), strict=True))


def _same(a: str, b: str | None) -> bool:
    return b is not None and hmac.compare_digest(a, b)


def _pkce_ok(verifier: object, challenge: str) -> bool:
    if not isinstance(verifier, str) or not _VERIFIER_RE.fullmatch(verifier):
        return False
    computed = _b64(hashlib.sha256(verifier.encode("ascii")).digest())
    return hmac.compare_digest(computed, challenge)


# ------------------------------------------------------------ wrong secrets, logged sparingly

WRONG_SECRET_LOG_EVERY = 60
_wrong_secret_log: dict[str, tuple[int, int]] = {}
_wrong_secret_lock = threading.Lock()


def _log_wrong_secret(grant_id: str, now: int) -> None:
    """A wrong secret against a real grant, logged at most once a minute per grant with a count
    of the rest. Grant ids are in Settings and in logs, so an unthrottled warning would be a log
    anyone could flood (finances' W8 gate)."""
    with _wrong_secret_lock:
        last, suppressed = _wrong_secret_log.get(grant_id, (now - WRONG_SECRET_LOG_EVERY, 0))
        if now - last < WRONG_SECRET_LOG_EVERY:
            _wrong_secret_log[grant_id] = (last, suppressed + 1)
            return
        _wrong_secret_log[grant_id] = (now, 0)
    log.warning("oauth grant %s: a refresh presented a wrong secret", grant_id)


def flush_wrong_secret_log(now: int) -> None:
    """Report the counts of bursts that have stopped, and forget quiet grants. The sweep calls
    it, so a burst's last count does not wait for a next wrong secret that may never come."""
    with _wrong_secret_lock:
        due = {
            gid: count
            for gid, (last, count) in _wrong_secret_log.items()
            if now - last >= WRONG_SECRET_LOG_EVERY
        }
        for gid, count in due.items():
            if count:
                _wrong_secret_log[gid] = (now, 0)
            else:
                del _wrong_secret_log[gid]
    for gid, count in due.items():
        if count:
            log.warning(
                "oauth grant %s: a refresh presented a wrong secret (%s more since the last"
                " report)",
                gid,
                count,
            )


def reset_wrong_secret_log() -> None:
    """Forget the rate limiter's state. For tests."""
    with _wrong_secret_lock:
        _wrong_secret_log.clear()


# ------------------------------------------------------------ requests and approval

_LIVE_REQUEST = "SELECT * FROM oauth_requests WHERE id_hash = ? AND expires_at > ?"


def _pending(row: sqlite3.Row) -> PendingRequest:
    return PendingRequest(
        client_id=row["client_id"],
        client_name=row["client_name"],
        client_host=row["client_host"],
        redirect_uri=row["redirect_uri"],
        redirect_host=urlsplit(row["redirect_uri"]).hostname or "",
        scope=row["scope"],
        state=row["state"],
        resource=row["resource"],
        expires_at=row["expires_at"],
    )


def create_request(
    conn: sqlite3.Connection,
    config: Config,
    client: Client,
    *,
    redirect_uri: str,
    code_challenge: str,
    resource: str,
    scope: str | None,
    state: str | None,
) -> str:
    """Hold an authorization request for the consent screen for REQUEST_LIFETIME seconds; returns
    its id, which only the consent screen's URL carries (the table holds its hash).

    The caller has checked `response_type`, the S256 challenge, `resource` and `scope` (W4).
    The redirect is checked again here, since a code must never go to one the client did not
    register: ClientRefused `redirect`. AuthError `busy` when MAX_REQUESTS are pending."""
    if not redirect_allowed(client, redirect_uri):
        raise ClientRefused("redirect")
    now = config.clock()
    request_id = secrets.token_urlsafe(32)
    with transaction(conn):
        _sweep(conn, now)
        if conn.execute("SELECT count(*) FROM oauth_requests").fetchone()[0] >= MAX_REQUESTS:
            raise AuthError("busy", retry_after=60)
        conn.execute(
            "INSERT INTO oauth_requests (id_hash, client_id, client_name, client_host,"
            " redirect_uri, code_challenge, resource, scope, state, created_at, expires_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                token_hash(request_id),
                client.client_id,
                client.name,
                client.host,
                redirect_uri,
                code_challenge,
                resource,
                scope,
                state,
                now,
                now + REQUEST_LIFETIME,
            ),
        )
    return request_id


def get_request(conn: sqlite3.Connection, config: Config, request_id: str) -> PendingRequest | None:
    """The pending request, or None if it is unknown, used or expired."""
    if not isinstance(request_id, str):
        return None
    row = conn.execute(_LIVE_REQUEST, (token_hash(request_id), config.clock())).fetchone()
    return None if row is None else _pending(row)


def deny_request(conn: sqlite3.Connection, config: Config, request_id: str) -> PendingRequest:
    """Use the request up without a grant; returns it, for the `access_denied` redirect.
    AuthError `no-request` if it is unknown, used or expired."""
    with transaction(conn):
        row = conn.execute(_LIVE_REQUEST, (token_hash(request_id), config.clock())).fetchone()
        if row is None:
            raise AuthError("no-request")
        conn.execute("DELETE FROM oauth_requests WHERE id_hash = ?", (row["id_hash"],))
    return _pending(row)


def approve(
    conn: sqlite3.Connection,
    config: Config,
    request_id: str,
    user_id: int,
    *,
    write: bool,
    limit: int | None = MAX_GRANTS,
) -> Approval:
    """Approve the request for the user: a new grant, `write` or `read` by the consent screen's
    box, and its code. The request is used up.

    The caller has already proved the password with `auth.login` (Argon2, the shared lockout),
    which runs outside any transaction; nothing here hashes, so the write lock is held briefly.

    AuthError `no-request`, `no-user`, `disabled`, or with a `limit`, `too-many-connections`
    when the user already holds that many live grants. The count and the insert share one write
    transaction, so two approvals cannot both take the last place; a refusal leaves the request
    for another try."""
    now = config.clock()
    code = CODE_PREFIX + _b64(secrets.token_bytes(32))
    grant_id = secrets.token_hex(16)
    with transaction(conn):
        _sweep(conn, now)
        row = conn.execute(_LIVE_REQUEST, (token_hash(request_id), now)).fetchone()
        if row is None:
            raise AuthError("no-request")
        user = conn.execute("SELECT disabled FROM users WHERE id = ?", (user_id,)).fetchone()
        if user is None:
            raise AuthError("no-user")
        if user["disabled"]:
            raise AuthError("disabled")
        if limit is not None:
            held = conn.execute(
                "SELECT count(*) FROM oauth_grants WHERE user_id = ?", (user_id,)
            ).fetchone()[0]
            if held >= limit:
                raise AuthError("too-many-connections")
        conn.execute("DELETE FROM oauth_requests WHERE id_hash = ?", (row["id_hash"],))
        conn.execute(
            "INSERT INTO oauth_grants (id, user_id, client_id, client_name, client_host, scope,"
            " resource, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                grant_id,
                user_id,
                row["client_id"],
                row["client_name"],
                row["client_host"],
                "write" if write else "read",
                row["resource"],
                now,
                now + GRANT_LIFETIME,
            ),
        )
        conn.execute(
            "INSERT INTO oauth_codes (code_hash, grant_id, client_id, redirect_uri,"
            " code_challenge, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                token_hash(code),
                grant_id,
                row["client_id"],
                row["redirect_uri"],
                row["code_challenge"],
                row["resource"],
                now + CODE_LIFETIME,
            ),
        )
    log.info("oauth grant %s approved for user %s by %s", grant_id, user_id, row["client_id"])
    return Approval(code, row["redirect_uri"], row["state"], grant_id)


# ------------------------------------------------------------ codes and refresh


def _end_grant(conn: sqlite3.Connection, grant_id: str) -> None:
    """Delete the grant; its codes, access tokens and retired tokens cascade. Never a flag."""
    conn.execute("DELETE FROM oauth_grants WHERE id = ?", (grant_id,))


def _grant(conn: sqlite3.Connection, grant_id: str) -> sqlite3.Row | None:
    row: sqlite3.Row | None = conn.execute(
        "SELECT g.*, u.disabled FROM oauth_grants g JOIN users u ON u.id = g.user_id"
        " WHERE g.id = ?",
        (grant_id,),
    ).fetchone()
    return row


def _add_access(
    conn: sqlite3.Connection, grant_id: str, access: str, now: int, grant_expires: int
) -> int:
    """Store an access token for an hour, or until its grant ends if sooner; returns its end."""
    expires_at = min(now + ACCESS_LIFETIME, grant_expires)
    conn.execute(
        "INSERT INTO oauth_access (token_hash, grant_id, created_at, expires_at)"
        " VALUES (?, ?, ?, ?)",
        (token_hash(access), grant_id, now, expires_at),
    )
    return expires_at


def redeem_code(
    conn: sqlite3.Connection,
    config: Config,
    *,
    code: str,
    client_id: str,
    redirect_uri: str,
    code_verifier: str,
    resource: str | None,
) -> Issued:
    """Exchange a code for the grant's first pair. InvalidGrant otherwise:

    `unknown` for a code that is unknown, expired or malformed; `code_mismatch` when the client,
    redirect, resource (if given) or PKCE verifier differs, which ends nothing; `disabled`; and
    `reuse`, with `ended`, for a second use that passes every binding: the code leaked with its
    verifier, so the grant and everything issued from it end (as finances does)."""
    if not isinstance(code, str) or not _CODE_RE.fullmatch(code):
        raise InvalidGrant(reason="unknown")
    now = config.clock()
    issued: Issued | None = None
    with transaction(conn):
        row = conn.execute(
            "SELECT c.*, g.scope, g.expires_at AS grant_expires, g.generation,"
            " g.refresh_hash, u.disabled"
            " FROM oauth_codes c JOIN oauth_grants g ON g.id = c.grant_id"
            " JOIN users u ON u.id = g.user_id WHERE c.code_hash = ?",
            (token_hash(code),),
        ).fetchone()
        if row is None or row["expires_at"] <= now:
            raise InvalidGrant(reason="unknown")
        if (
            client_id != row["client_id"]
            or redirect_uri != row["redirect_uri"]
            or (resource is not None and resource != row["resource"])
            or not _pkce_ok(code_verifier, row["code_challenge"])
        ):
            raise InvalidGrant(reason="code_mismatch")
        grant_id: str = row["grant_id"]
        if row["redeemed_at"] is not None:
            _end_grant(conn, grant_id)  # committed below, before the refusal is raised
        else:
            if row["disabled"]:
                raise InvalidGrant(reason="disabled")
            access_raw, refresh_raw = secrets.token_bytes(32), secrets.token_bytes(32)
            access, fresh = _access_token(access_raw), _refresh_token(grant_id, refresh_raw)
            conn.execute(
                "UPDATE oauth_codes SET redeemed_at = ? WHERE code_hash = ?",
                (now, row["code_hash"]),
            )
            started = conn.execute(
                "UPDATE oauth_grants SET refresh_hash = ?, last_used_at = ?, generation = 1"
                " WHERE id = ? AND generation = 0 AND refresh_hash IS NULL",
                (token_hash(fresh), now, grant_id),
            ).rowcount
            if started != 1:
                raise InvalidGrant(reason="unknown")
            expires_at = _add_access(conn, grant_id, access, now, row["grant_expires"])
            issued = Issued(access, fresh, expires_at - now, row["scope"])
    if issued is None:
        log.warning("oauth grant %s ended: its authorization code was used twice", grant_id)
        raise InvalidGrant("the authorization code was used twice", reason="reuse", ended=True)
    return issued


def _rotate(
    conn: sqlite3.Connection, row: sqlite3.Row, secret: bytes, old_hash: str, now: int
) -> Issued | None:
    """Swap in a new pair if the row is still at the generation read; None if a twin got there
    first (rowcount 0), and nothing is written."""
    grant_id: str = row["id"]
    generation = int(row["generation"]) + 1
    access_raw, refresh_raw = secrets.token_bytes(32), secrets.token_bytes(32)
    access, fresh = _access_token(access_raw), _refresh_token(grant_id, refresh_raw)
    sealed = _seal(access_raw + refresh_raw, secret, grant_id, generation)
    with transaction(conn):
        swapped = conn.execute(
            "UPDATE oauth_grants SET refresh_hash = ?, prev_refresh_hash = ?, grace_until = ?,"
            " grace_pair = ?, last_used_at = ?, generation = ?"
            " WHERE id = ? AND generation = ? AND refresh_hash = ?",
            (
                token_hash(fresh),
                old_hash,
                now + GRACE_SECONDS,
                sealed,
                now,
                generation,
                grant_id,
                generation - 1,
                old_hash,
            ),
        ).rowcount
        if swapped != 1:
            return None
        conn.execute("INSERT OR IGNORE INTO oauth_retired VALUES (?, ?)", (grant_id, old_hash))
        expires_at = _add_access(conn, grant_id, access, now, row["expires_at"])
    return Issued(access, fresh, expires_at - now, row["scope"])


def _from_grace(conn: sqlite3.Connection, row: sqlite3.Row, secret: bytes, now: int) -> Issued:
    """The pair that replaced `secret`'s token, for a twin inside the grace."""
    grant_id: str = row["id"]
    blob = row["grace_pair"]
    pair = (
        _seal(blob, secret, grant_id, int(row["generation"]))
        if isinstance(blob, bytes) and len(blob) == 64
        else b""
    )
    fresh = _refresh_token(grant_id, pair[32:])
    if not _same(token_hash(fresh), row["refresh_hash"]):
        log.error("oauth grant %s failed its integrity check: the grace copy is wrong", grant_id)
        raise InvalidGrant(reason="tamper")
    access = _access_token(pair[:32])
    held = conn.execute(
        "SELECT expires_at FROM oauth_access WHERE token_hash = ?", (token_hash(access),)
    ).fetchone()
    if held is None or held["expires_at"] <= now:
        raise InvalidGrant(reason="unknown")  # revoked meanwhile: never hand back a dead token
    return Issued(access, fresh, held["expires_at"] - now, row["scope"])


def refresh(
    conn: sqlite3.Connection,
    config: Config,
    *,
    refresh_token: str,
    client_id: str,
    resource: str,
) -> Issued:
    """Rotate the pair, or raise InvalidGrant. `resource` is this server's own (W4 refuses a
    different one the client names with `invalid_target` before calling).

    The current token rotates, with a compare-and-swap on the generation. The token it replaced
    gets the same new pair for GRACE_SECONDS. Any other retired token ends the grant (`reuse`),
    as does presenting one after the grant's 90 days (`expired`): both with `ended`. A wrong
    client or resource is refused and ends nothing, as is a token that matches nothing
    (`wrong_secret`, logged sparingly against its grant; `unknown` for no such grant)."""
    parsed = _parse_refresh(refresh_token)
    if parsed is None:
        raise InvalidGrant(reason="malformed")
    grant_id, secret = parsed
    presented = token_hash(refresh_token)
    # Two passes at most: a swap lost to a twin reads the row again, and then finds the twin's
    # pair in the grace.
    for _attempt in range(2):
        now = config.clock()
        row = _grant(conn, grant_id)
        if row is None:
            raise InvalidGrant(reason="unknown")
        if row["client_id"] != client_id:
            raise InvalidGrant(reason="client")
        if row["resource"] != resource:
            log.warning(
                "oauth grant %s is for %s, but this server expects %s",
                grant_id,
                row["resource"],
                resource,
            )
            raise InvalidGrant(reason="resource")
        if now >= row["expires_at"]:
            _end_grant(conn, grant_id)
            log.info("oauth grant %s ended: expired", grant_id)
            raise InvalidGrant("the connection has expired", reason="expired", ended=True)
        if row["disabled"]:
            raise InvalidGrant(reason="disabled")
        if _same(presented, row["refresh_hash"]):
            issued = _rotate(conn, row, secret, presented, now)
            if issued is None:
                continue
            return issued
        if _same(presented, row["prev_refresh_hash"]) and now <= row["grace_until"]:
            return _from_grace(conn, row, secret, now)
        retired = conn.execute(
            "SELECT 1 FROM oauth_retired WHERE grant_id = ? AND refresh_hash = ?",
            (grant_id, presented),
        ).fetchone()
        if retired is not None:
            # OAuth 2.1 §4.3.1: an old token after the grace means two parties hold this grant.
            _end_grant(conn, grant_id)
            log.warning("oauth grant %s ended: a retired refresh token was reused", grant_id)
            raise InvalidGrant("a refresh token was used twice", reason="reuse", ended=True)
        _log_wrong_secret(grant_id, now)
        raise InvalidGrant(reason="wrong_secret")
    raise InvalidGrant(reason="busy")


# ------------------------------------------------------------ access, revocation, Settings


def access_user(conn: sqlite3.Connection, config: Config, token: str) -> AccessUser | None:
    """Who an access token acts as, or None for one unknown, malformed, expired, past its grant,
    or of a disabled account. It never raises on what a client sends, and checks expiry on
    `config.clock` (F9). The grant's `last_used_at` moves at most once a minute."""
    if not isinstance(token, str) or not _ACCESS_RE.fullmatch(token):
        return None
    now = config.clock()
    row = conn.execute(
        "SELECT a.expires_at, g.id, g.user_id, g.scope, g.resource, g.last_used_at,"
        " g.expires_at AS grant_expires, u.username, u.disabled"
        " FROM oauth_access a JOIN oauth_grants g ON g.id = a.grant_id"
        " JOIN users u ON u.id = g.user_id WHERE a.token_hash = ?",
        (token_hash(token),),
    ).fetchone()
    if row is None or row["disabled"]:
        return None
    expires_at = min(int(row["expires_at"]), int(row["grant_expires"]))
    if expires_at <= now:
        return None
    if row["last_used_at"] is None or now - row["last_used_at"] > LAST_USED_EVERY:
        conn.execute("UPDATE oauth_grants SET last_used_at = ? WHERE id = ?", (now, row["id"]))
    return AccessUser(
        int(row["user_id"]), row["username"], row["scope"], row["resource"], expires_at, row["id"]
    )


def revoke(conn: sqlite3.Connection, config: Config, token: str) -> None:
    """RFC 7009, as finances does it: an access token ends itself; a refresh token ends its grant.

    A refresh token must prove itself: the current one, the one inside the grace, or a retired
    one (which ends the grant just as reusing it would, and is logged). A grant id alone ends
    nothing; a wrong secret is logged sparingly. Anything else is ignored, as RFC 7009 says."""
    if not isinstance(token, str):
        return
    if _ACCESS_RE.fullmatch(token):
        conn.execute("DELETE FROM oauth_access WHERE token_hash = ?", (token_hash(token),))
        return
    parsed = _parse_refresh(token)
    if parsed is None:
        return
    grant_id = parsed[0]
    row = _grant(conn, grant_id)
    if row is None:
        return
    now = config.clock()
    presented = token_hash(token)
    in_grace = row["grace_until"] is not None and now <= row["grace_until"]
    if _same(presented, row["refresh_hash"]) or (
        in_grace and _same(presented, row["prev_refresh_hash"])
    ):
        _end_grant(conn, grant_id)
        log.info("oauth grant %s ended: revoked by its client", grant_id)
    elif conn.execute(
        "SELECT 1 FROM oauth_retired WHERE grant_id = ? AND refresh_hash = ?",
        (grant_id, presented),
    ).fetchone():
        _end_grant(conn, grant_id)
        log.warning("oauth grant %s ended: a retired refresh token was revoked", grant_id)
    else:
        _log_wrong_secret(grant_id, now)


def list_grants(conn: sqlite3.Connection, config: Config, user_id: int) -> list[GrantInfo]:
    """The user's live connections, newest first. An approval whose code was never redeemed is
    not a connection, and is not listed. Sweeps first."""
    sweep(conn, config)
    now = config.clock()
    rows = conn.execute(
        "SELECT id, client_id, client_name, client_host, scope, created_at, last_used_at,"
        " expires_at FROM oauth_grants"
        " WHERE user_id = ? AND refresh_hash IS NOT NULL AND expires_at > ?"
        " ORDER BY created_at DESC, id",
        (user_id, now),
    ).fetchall()
    return [
        GrantInfo(
            grant_id=r["id"],
            client_id=r["client_id"],
            client_name=r["client_name"],
            client_host=r["client_host"],
            scope=r["scope"],
            created_at=r["created_at"],
            last_used_at=r["last_used_at"],
            expires_at=r["expires_at"],
            is_new=now - r["created_at"] < NEW_FOR,
        )
        for r in rows
    ]


def remove_grant(conn: sqlite3.Connection, user_id: int, grant_id: str) -> None:
    """End one of the user's connections, from Settings. AuthError `no-connection` for an id that
    is unknown or another user's, so the two look the same."""
    deleted = conn.execute(
        "DELETE FROM oauth_grants WHERE id = ? AND user_id = ?", (grant_id, user_id)
    ).rowcount
    if deleted != 1:
        raise AuthError("no-connection")
    log.info("oauth grant %s ended in Settings", grant_id)


def _sweep(conn: sqlite3.Connection, now: int) -> int:
    conn.execute("DELETE FROM oauth_requests WHERE expires_at <= ?", (now,))
    grants = conn.execute(
        "DELETE FROM oauth_grants WHERE expires_at <= ?"
        " OR (refresh_hash IS NULL AND created_at + ? <= ?)",
        (now, CODE_LIFETIME, now),
    ).rowcount
    conn.execute("DELETE FROM oauth_codes WHERE expires_at <= ?", (now,))
    conn.execute("DELETE FROM oauth_access WHERE expires_at <= ?", (now,))
    # Past its grace, the sealed copy of the live pair would only help someone holding a copy
    # of the database and the replaced token; `oauth_retired` still catches that token's reuse.
    conn.execute(
        "UPDATE oauth_grants SET grace_pair = NULL, prev_refresh_hash = NULL, grace_until = NULL"
        " WHERE grace_until < ?",
        (now,),
    )
    return grants


def sweep(conn: sqlite3.Connection, config: Config) -> int:
    """Delete expired requests, codes and access tokens, and grants that have ended or whose code
    lapsed unredeemed; returns how many grants. It also reports wrong-secret counts that are due.
    Requests, approvals and the Settings list call it; W4's token endpoint may too."""
    now = config.clock()
    flush_wrong_secret_log(now)
    with transaction(conn):
        return _sweep(conn, now)
