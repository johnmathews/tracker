"""The shared library over REST (docs/specs/2026-11-19-shared-library.md §3 to §5): the admin
flag on the session, publish with its preview and token, unpublish, the shared list and copy into
an account's own library. No shared response names anyone (S2)."""

import copy
import json
import re
import sqlite3
from collections.abc import Iterator
from dataclasses import replace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tracker_api import auth, data
from tracker_api.app import create_app
from tracker_api.config import Config
from tracker_api.db import connect

from .conftest import ORIGIN, Clock
from .test_api import PASSWORD, other_client, sign_up
from .test_programmes_api import add, delete, doc

ADMIN = "alice@example.com"
USER = "bob@example.com"
SUMMARY_KEYS = {"id", "name", "description", "kind", "weeks", "activities", "updatedAt"}
RECORD_KEYS = {*SUMMARY_KEYS, "rev", "createdAt", "doc"}


def db(config: Config) -> sqlite3.Connection:
    return connect(config.db_path)


def set_admin(config: Config, username: str, admin: bool = True) -> None:
    conn = db(config)
    try:
        auth.set_admin(conn, username, admin)
    finally:
        conn.close()


def shared_rows(config: Config) -> list[dict[str, Any]]:
    conn = db(config)
    try:
        return [dict(r) for r in conn.execute("SELECT * FROM shared_programmes ORDER BY id")]
    finally:
        conn.close()


def user_ids(config: Config) -> dict[str, int]:
    conn = db(config)
    try:
        return {r["username"]: r["id"] for r in conn.execute("SELECT id, username FROM users")}
    finally:
        conn.close()


@pytest.fixture
def admin(client: TestClient, config: Config) -> TestClient:
    """Alice, signed in, with the admin flag set after her session began: the flag is read on
    every request, so a remembered session has it too."""
    sign_up(client, config, ADMIN)
    set_admin(config, ADMIN)
    return client


@pytest.fixture
def user(config: Config) -> Iterator[TestClient]:
    """Bob, an ordinary account, in his own client."""
    with other_client(config) as bob:
        sign_up(bob, config, USER)
        yield bob


def publish(client: TestClient, programme_id: str, **body: Any) -> Any:
    return client.post(f"/api/programmes/{programme_id}/publish", json=body)


def published(client: TestClient, programme_id: str) -> dict[str, Any]:
    """Preview, then confirm with the preview's rev: the confirm's body."""
    preview = publish(client, programme_id)
    assert preview.status_code == 200, preview.text
    r = publish(client, programme_id, preview=False, rev=preview.json()["rev"])
    assert r.status_code == 200, r.text
    return r.json()  # type: ignore[no-any-return]


def shared_programme(admin: TestClient, name: str = "beginner-5x5") -> tuple[str, str]:
    """A library programme of the admin's, published: (library id, shared id)."""
    programme_id = add(admin, doc(name)).json()["id"]
    return programme_id, published(admin, programme_id)["shared"]["id"]


def summary_of(document: dict[str, Any], shared_id: str | None, at: int) -> dict[str, Any]:
    return {
        "id": shared_id,
        "name": document["name"],
        "description": document.get("description"),
        "kind": document["kind"],
        "weeks": document["weeks"],
        "activities": len(document["activities"]),
        "updatedAt": at,
    }


# --- the admin flag ------------------------------------------------------------------------------


def test_me_and_login_say_admin_only_for_an_admin(client: TestClient, config: Config) -> None:
    sign_up(client, config, ADMIN)
    assert client.get("/api/auth/me").json() == {"username": ADMIN}
    set_admin(config, ADMIN)
    # The same session, read again: the flag comes from the account on every request.
    assert client.get("/api/auth/me").json() == {"username": ADMIN, "admin": True}
    client.post("/api/auth/logout", json={})
    r = client.post("/api/auth/login", json={"username": ADMIN, "password": PASSWORD})
    assert r.json() == {"username": ADMIN, "admin": True}
    set_admin(config, ADMIN, False)
    assert client.get("/api/auth/me").json() == {"username": ADMIN}


def test_signup_never_makes_an_admin(client: TestClient) -> None:
    r = client.post("/api/auth/signup", json={"email": USER, "password": PASSWORD})
    assert r.json() == {"username": USER}


def test_the_admin_flag_is_checked_on_every_publish(admin: TestClient, config: Config) -> None:
    """S1: an account that loses the flag mid-session is refused at once."""
    programme_id = add(admin, doc()).json()["id"]
    preview = publish(admin, programme_id).json()
    set_admin(config, ADMIN, False)
    r = publish(admin, programme_id, preview=False, rev=preview["rev"])
    assert (r.status_code, r.json()) == (403, {"error": "not-admin"})
    assert shared_rows(config) == []


# --- who may do what -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/shared-programmes"),
        ("GET", "/api/shared-programmes/xs1"),
        ("GET", "/api/shared-programmes/xs1/preview"),
        ("POST", "/api/shared-programmes/xs1/copy"),
        ("POST", "/api/programmes/xp1/publish"),
        ("DELETE", "/api/shared-programmes/xs1"),
    ],
)
def test_the_shared_library_needs_a_session(client: TestClient, method: str, path: str) -> None:
    r = client.request(method, path, json={}, headers={"Content-Type": "application/json"})
    assert (r.status_code, r.json()) == (401, {"error": "auth"})


def test_a_non_admin_can_neither_publish_nor_unpublish(
    admin: TestClient, user: TestClient, config: Config
) -> None:
    """403 before anything else, so an unknown id answers the same and names nothing."""
    _, shared_id = shared_programme(admin)
    own = add(user, doc()).json()["id"]
    before = shared_rows(config)
    for programme_id in (own, "nope"):
        r = publish(user, programme_id)
        assert (r.status_code, r.json()) == (403, {"error": "not-admin"})
        r = publish(user, programme_id, preview=False, rev="0123456789abcdef")
        assert (r.status_code, r.json()) == (403, {"error": "not-admin"})
    for target in (shared_id, "nope"):
        r = delete(user, f"/api/shared-programmes/{target}")
        assert (r.status_code, r.json()) == (403, {"error": "not-admin"})
    assert shared_rows(config) == before


# --- publish -------------------------------------------------------------------------------------


def test_publish_previews_then_confirms(admin: TestClient, config: Config, clock: Clock) -> None:
    """S5: the preview is the document as every user will see it, and writes nothing."""
    document = doc()
    programme_id = add(admin, document).json()["id"]
    clock.advance(60)
    r = publish(admin, programme_id)
    assert r.status_code == 200, r.text
    preview = r.json()
    assert re.fullmatch(r"[0-9a-f]{16}", preview["rev"])
    assert preview == {
        "preview": True,
        "rev": preview["rev"],
        "publish": {
            # Not published yet, so it has no shared id.
            "programme": {**summary_of(document, None, clock.now), "doc": document},
            "replaces": None,
        },
    }
    # `preview: true` says the same, and previewing again gives the same token.
    assert publish(admin, programme_id, preview=True).json() == preview
    assert shared_rows(config) == []
    clock.advance(60)
    r = publish(admin, programme_id, preview=False, rev=preview["rev"])
    assert r.status_code == 200, r.text
    out = r.json()
    assert out == {"preview": False, "shared": {"id": out["shared"]["id"], "updatedAt": clock.now}}
    assert re.fullmatch(r"x[0-9a-z]{8,9}[0-9a-z]{4}", out["shared"]["id"])
    (row,) = shared_rows(config)
    assert row == {
        "id": out["shared"]["id"],
        "name": document["name"],
        "doc_json": data.encode_programme(document),
        "rev": 1,
        "published_by": user_ids(config)[ADMIN],
        "source_id": programme_id,
        "published_at": clock.now,
        "updated_at": clock.now,
    }


def test_publish_again_replaces_the_shared_copy(
    admin: TestClient, config: Config, clock: Clock
) -> None:
    """Same library programme, same shared id: its rev and time move on, its first publish
    stays, and the preview says what it replaces."""
    programme_id, shared_id = shared_programme(admin)
    first = clock.now
    clock.advance(3600)
    changed = {**doc(), "description": "Now with a deload."}
    assert (
        admin.put(f"/api/programmes/{programme_id}", json={"doc": changed, "rev": 1}).status_code
        == 200
    )
    preview = publish(admin, programme_id).json()
    assert preview["publish"]["replaces"] == {"id": shared_id, "updatedAt": first}
    assert preview["publish"]["programme"]["id"] == shared_id
    assert preview["publish"]["programme"]["description"] == "Now with a deload."
    clock.advance(60)
    out = publish(admin, programme_id, preview=False, rev=preview["rev"]).json()
    assert out == {"preview": False, "shared": {"id": shared_id, "updatedAt": clock.now}}
    (row,) = shared_rows(config)
    assert (row["rev"], row["published_at"], row["updated_at"]) == (2, first, clock.now)
    assert json.loads(row["doc_json"]) == changed


def test_a_stale_publish_is_a_409_with_a_fresh_preview(admin: TestClient, config: Config) -> None:
    """P2: the token covers the library programme's rev and the shared copy it replaces; a
    confirm on either changed since writes nothing."""
    programme_id = add(admin, doc()).json()["id"]
    old = publish(admin, programme_id).json()
    url = f"/api/programmes/{programme_id}"
    admin.put(url, json={"doc": {**doc(), "name": "Renamed"}, "rev": 1})
    r = publish(admin, programme_id, preview=False, rev=old["rev"])
    assert r.status_code == 409
    fresh = publish(admin, programme_id).json()
    assert r.json() == {"error": "conflict", "rev": fresh["rev"], "preview": fresh}
    assert fresh["rev"] != old["rev"]
    assert fresh["publish"]["programme"]["name"] == "Renamed"
    assert shared_rows(config) == []
    # Published from another tab since the preview: the shared copy it would replace changed.
    published(admin, programme_id)
    r = publish(admin, programme_id, preview=False, rev=fresh["rev"])
    assert r.status_code == 409
    assert r.json()["preview"]["publish"]["replaces"]["id"] == shared_rows(config)[0]["id"]
    assert shared_rows(config)[0]["rev"] == 1


@pytest.mark.parametrize(
    "body",
    [{"preview": False}, {"preview": False, "rev": 1}, {"preview": "no"}],
)
def test_a_publish_with_problems_is_a_400(
    admin: TestClient, config: Config, body: dict[str, Any]
) -> None:
    programme_id = add(admin, doc()).json()["id"]
    r = publish(admin, programme_id, **body)
    assert r.status_code == 400
    assert r.json()["error"] == "invalid"
    assert shared_rows(config) == []


def test_publish_needs_a_programme_of_the_admins(
    admin: TestClient, user: TestClient, config: Config
) -> None:
    theirs = add(user, doc()).json()["id"]
    for programme_id in ("nope", theirs):
        r = publish(admin, programme_id)
        assert (r.status_code, r.json()) == (404, {"error": "not-found"})
        r = publish(admin, programme_id, preview=False, rev="0123456789abcdef")
        assert (r.status_code, r.json()) == (404, {"error": "not-found"})


def test_a_published_programme_is_a_snapshot(
    admin: TestClient, user: TestClient, config: Config
) -> None:
    """S3: editing or deleting the admin's library programme changes nothing shared."""
    programme_id, shared_id = shared_programme(admin)
    before = user.get(f"/api/shared-programmes/{shared_id}").json()
    url = f"/api/programmes/{programme_id}"
    admin.put(url, json={"doc": {**doc(), "name": "Changed"}, "rev": 1})
    assert user.get(f"/api/shared-programmes/{shared_id}").json() == before
    assert delete(admin, url).status_code == 204
    assert user.get(f"/api/shared-programmes/{shared_id}").json() == before


# --- the shared list -----------------------------------------------------------------------------


def test_any_user_lists_and_reads_the_shared_library(
    admin: TestClient, user: TestClient, clock: Clock
) -> None:
    assert user.get("/api/shared-programmes").json() == {"programmes": []}
    _, older = shared_programme(admin, "beginner-5x5")
    first = clock.now
    clock.advance(60)
    _, newer = shared_programme(admin, "cardio")
    # Newest publish first.
    assert user.get("/api/shared-programmes").json() == {
        "programmes": [
            summary_of(doc("cardio"), newer, clock.now),
            summary_of(doc("beginner-5x5"), older, first),
        ]
    }
    r = user.get(f"/api/shared-programmes/{older}")
    assert r.json() == {"programme": {**summary_of(doc(), older, first), "doc": doc()}}
    # The admin reads it the same way.
    assert admin.get(f"/api/shared-programmes/{older}").json() == r.json()
    r = user.get("/api/shared-programmes/nope")
    assert (r.status_code, r.json()) == (404, {"error": "not-found"})


def test_no_shared_response_names_anyone(
    admin: TestClient, user: TestClient, config: Config
) -> None:
    """S2: a username is an email. Nothing a user reads of the shared library carries the
    admin's username, a user id, or the library programme it came from."""
    programme_id, shared_id = shared_programme(admin)
    ids = user_ids(config)
    copied = user.post(f"/api/shared-programmes/{shared_id}/copy", json={})
    bodies = [
        user.get("/api/shared-programmes"),
        user.get(f"/api/shared-programmes/{shared_id}"),
        copied,
        user.get("/api/programmes"),
    ]
    for r in bodies:
        assert r.status_code in (200, 201), r.text
        text = r.text
        assert ADMIN not in text and "alice" not in text
        assert programme_id not in text
        for key in ("published_by", "publishedBy", "source_id", "sourceId", "owner", "user"):
            assert f'"{key}"' not in text
    (listed,) = bodies[0].json()["programmes"]
    assert set(listed) == SUMMARY_KEYS
    assert set(bodies[1].json()["programme"]) == {*SUMMARY_KEYS, "doc"}
    assert set(copied.json()) == RECORD_KEYS
    # The only numbers are the counts and the times, so no user id hides in a value.
    numbers = {k for k, v in {**listed, **copied.json()}.items() if isinstance(v, int)}
    assert numbers <= {"weeks", "activities", "updatedAt", "rev", "createdAt"}
    assert ids[ADMIN] != ids[USER]


# --- copy ----------------------------------------------------------------------------------------


def test_preview_shows_a_shared_programme_and_its_plan_to_anyone(
    admin: TestClient, user: TestClient, config: Config
) -> None:
    """K173: the document and the plan a start would write today at the programme's own
    values, the same as the admin's own start preview; nothing is written and no one named."""
    programme_id, shared_id = shared_programme(admin)
    before = shared_rows(config)
    r = user.get(f"/api/shared-programmes/{shared_id}/preview")
    assert r.status_code == 200, r.text
    out = r.json()
    assert set(out) == {"programme", "plan"}
    assert set(out["programme"]) == {*SUMMARY_KEYS, "doc"}
    assert out["programme"]["id"] == shared_id
    assert out["programme"]["doc"] == doc()
    own = admin.post(f"/api/programmes/{programme_id}/preview", json={}).json()
    assert out["plan"] == own
    assert shared_rows(config) == before
    assert user.get("/api/programmes").json()["programmes"] == []
    assert "alice" not in r.text


def test_preview_of_an_unknown_shared_programme_is_a_404(user: TestClient) -> None:
    r = user.get("/api/shared-programmes/nope/preview")
    assert (r.status_code, r.json()) == (404, {"error": "not-found"})


def test_copy_adds_a_plain_copy_to_the_callers_library(
    admin: TestClient, user: TestClient, config: Config, clock: Clock
) -> None:
    """S4: an ordinary library programme with a new id and the shared name, as `POST
    /api/programmes` answers, that starts like any other and keeps no link back."""
    _, shared_id = shared_programme(admin)
    clock.advance(60)
    r = user.post(f"/api/shared-programmes/{shared_id}/copy", json={})
    assert r.status_code == 201, r.text
    record = r.json()
    assert record["id"] != shared_id
    assert re.fullmatch(r"x[0-9a-z]{8,9}[0-9a-z]{4}", record["id"])
    assert record == {
        "id": record["id"],
        "name": doc()["name"],
        "description": doc()["description"],
        "kind": "strength",
        "weeks": 8,
        "activities": len(doc()["activities"]),
        "rev": 1,
        "createdAt": clock.now,
        "updatedAt": clock.now,
        "doc": doc(),
    }
    assert user.get(f"/api/programmes/{record['id']}").json() == record
    assert [p["id"] for p in user.get("/api/programmes").json()["programmes"]] == [record["id"]]
    started = user.post(f"/api/programmes/{record['id']}/start", json={})
    assert started.status_code == 201, started.text
    # A copy is the user's own: a second copy is a second programme.
    again = user.post(f"/api/shared-programmes/{shared_id}/copy", json={}).json()
    assert again["id"] != record["id"]
    assert len(user.get("/api/programmes").json()["programmes"]) == 2


def test_a_later_publish_never_reaches_a_copy(admin: TestClient, user: TestClient) -> None:
    programme_id, shared_id = shared_programme(admin)
    record = user.post(f"/api/shared-programmes/{shared_id}/copy", json={}).json()
    admin.put(f"/api/programmes/{programme_id}", json={"doc": {**doc(), "weeks": 6}, "rev": 1})
    published(admin, programme_id)
    assert user.get(f"/api/programmes/{record['id']}").json() == record


def test_copy_of_an_unknown_programme_is_a_404(user: TestClient, config: Config) -> None:
    r = user.post("/api/shared-programmes/nope/copy", json={})
    assert (r.status_code, r.json()) == (404, {"error": "not-found"})


def test_copy_counts_against_the_library_cap(
    admin: TestClient, user: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, shared_id = shared_programme(admin)
    monkeypatch.setattr(data, "MAX_PROGRAMMES", 1)
    add(user, doc("minimal"))
    r = user.post(f"/api/shared-programmes/{shared_id}/copy", json={})
    assert (r.status_code, r.json()) == (409, {"error": "too-many"})
    assert len(user.get("/api/programmes").json()["programmes"]) == 1


def test_copy_counts_against_the_accounts_quota(
    admin: TestClient, user: TestClient, config: Config
) -> None:
    _, shared_id = shared_programme(admin)
    full = replace(config, user_quota_bytes=1)
    with TestClient(
        create_app(full, run_backups=False), base_url=ORIGIN, headers={"Origin": ORIGIN}
    ) as tight:
        tight.cookies.update(user.cookies)
        r = tight.post(f"/api/shared-programmes/{shared_id}/copy", json={})
        assert (r.status_code, r.json()) == (413, {"error": "quota"})
    assert user.get("/api/programmes").json() == {"programmes": []}


def test_the_shared_library_counts_against_nobodys_quota(admin: TestClient, config: Config) -> None:
    programme_id, _ = shared_programme(admin)
    delete(admin, f"/api/programmes/{programme_id}")
    conn = db(config)
    try:
        assert data.usage(conn, user_ids(config)[ADMIN]) == 0
    finally:
        conn.close()


# --- unpublish -----------------------------------------------------------------------------------


def test_unpublish_removes_it_and_copies_stay(
    admin: TestClient, user: TestClient, config: Config
) -> None:
    programme_id, shared_id = shared_programme(admin)
    record = user.post(f"/api/shared-programmes/{shared_id}/copy", json={}).json()
    r = delete(admin, f"/api/shared-programmes/{shared_id}")
    assert r.status_code == 204
    assert shared_rows(config) == []
    assert user.get("/api/shared-programmes").json() == {"programmes": []}
    assert user.get(f"/api/shared-programmes/{shared_id}").status_code == 404
    assert user.get(f"/api/programmes/{record['id']}").json() == record
    r = delete(admin, f"/api/shared-programmes/{shared_id}")
    assert (r.status_code, r.json()) == (404, {"error": "not-found"})
    # Publishing again makes a new shared programme.
    assert published(admin, programme_id)["shared"]["id"] != shared_id


# --- the admin's library ------------------------------------------------------------------------


def test_the_admins_library_says_what_is_shared(
    admin: TestClient, user: TestClient, config: Config, clock: Clock
) -> None:
    shared_source, shared_id = shared_programme(admin)
    private = add(admin, doc("cardio")).json()["id"]
    summaries = {p["id"]: p for p in admin.get("/api/programmes").json()["programmes"]}
    assert summaries[shared_source]["shared"] == {"id": shared_id, "updatedAt": clock.now}
    assert summaries[private]["shared"] is None
    assert set(summaries[private]) == {*RECORD_KEYS - {"doc"}, "shared"}
    # Nobody else's summaries carry the field, nor the admin's once the flag is off.
    add(user, doc())
    (theirs,) = user.get("/api/programmes").json()["programmes"]
    assert "shared" not in theirs
    set_admin(config, ADMIN, False)
    assert all("shared" not in p for p in admin.get("/api/programmes").json()["programmes"])
    set_admin(config, ADMIN)
    delete(admin, f"/api/shared-programmes/{shared_id}")
    summaries = {p["id"]: p for p in admin.get("/api/programmes").json()["programmes"]}
    assert summaries[shared_source]["shared"] is None


def test_another_admins_publication_is_not_marked_in_this_library(
    admin: TestClient, user: TestClient, config: Config
) -> None:
    """`source_id` is the publishing admin's: a second admin's own library never shows it."""
    _, shared_id = shared_programme(admin)
    set_admin(config, USER)
    record = user.post(f"/api/shared-programmes/{shared_id}/copy", json={}).json()
    (mine,) = user.get("/api/programmes").json()["programmes"]
    assert (mine["id"], mine["shared"]) == (record["id"], None)
    # Any admin may unpublish it.
    assert delete(user, f"/api/shared-programmes/{shared_id}").status_code == 204


# --- export and import ---------------------------------------------------------------------------


def test_export_and_import_leave_the_shared_library_out(
    admin: TestClient, user: TestClient, config: Config
) -> None:
    """F14: the shared library is no account's data. An export, the admin's included, carries
    none of it, and an import never writes it."""
    programme_id, shared_id = shared_programme(admin)
    delete(admin, f"/api/programmes/{programme_id}")
    user.post(f"/api/shared-programmes/{shared_id}/copy", json={})
    admin_file = admin.get("/api/export").json()
    user_file = user.get("/api/export").json()
    assert "programmes" not in admin_file
    assert shared_id not in json.dumps(admin_file) and shared_id not in json.dumps(user_file)
    assert all("shared" not in key.lower() for key in {*admin_file, *user_file})
    (copied,) = user_file["programmes"]
    assert copied["doc"] == doc()
    before = shared_rows(config)
    for client, file in ((admin, user_file), (user, admin_file), (user, user_file)):
        r = client.post("/api/import", content=json.dumps(file), headers=json_type())
        assert r.status_code == 200, r.text
    assert shared_rows(config) == before


def json_type() -> dict[str, str]:
    return {"Content-Type": "application/json"}


def test_a_doc_copied_under_another_name_is_unaffected(admin: TestClient) -> None:
    """The copy keeps the document as published, whatever the admin's library calls it now."""
    programme_id, shared_id = shared_programme(admin)
    admin.put(f"/api/programmes/{programme_id}", json={"doc": {**doc(), "name": "Mine"}, "rev": 1})
    record = admin.post(f"/api/shared-programmes/{shared_id}/copy", json={}).json()
    assert record["name"] == doc()["name"]
    assert record["doc"] == copy.deepcopy(doc())
