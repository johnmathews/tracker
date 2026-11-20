# Shared library

> Purpose
>
> How a user finds a programme someone else wrote: a shared library that only an admin publishes
> to, from which any user copies a programme into their own library, then adjusts and runs it as
> today. It is the authority for #88's build, after the mockup round in §7.

**Status:** approved by John on 2026-11-19 ("Approve (Recommended)"), views picked the same day (K171), Copy's question added after John tried it (K172), Preview (K173), the copy landing (K174),
the preview's width (K175), the centred page (K176) and the Reference tab (K177); built. Answers taken from John on 2026-11-19: an admin
flag with a Publish button; a copy is a plain copy; "adjust" means an agent or the start options;
agents can browse and copy. It amends [the programmes spec](2026-11-17-programmes.md) §2 and §11.

## 1. Terms

- **Library:** an account's own programmes, as today (the `programmes` table). Only its owner sees it.
- **Shared library:** programmes every signed-in user can see. Only an admin adds to it.
- **Admin:** an account with the admin flag. Today that is John's account alone.
- **Publish:** copy a programme from the admin's library into the shared library.
- **Copy:** copy a shared programme into the caller's own library.

## 2. Rules

- **S1. Only an admin publishes.** The server checks the flag on every publish and unpublish.
  Hiding the button is not the check.
- **S2. A shared programme names no one.** A username is an email address, so no shared response
  carries an owner, a user id or a username.
- **S3. Publishing is a snapshot.** The shared library keeps its own copy of the document. Editing or
  deleting the programme in the admin's library changes nothing shared. Publish again to update it.
- **S4. A copy is the user's own.** It is an ordinary library programme with a new id. It keeps no
  link to the shared original, and later publishes don't reach it.
- **S5. Publish previews.** The preview shows the document as every user will see it: name,
  description, each activity's notes and links. Nothing is shared until the admin confirms (P2).

## 3. Who is an admin

- `users` gains `admin` (0 or 1, default 0), in schema 19.
- `tracker-admin admin <email>` sets it and `tracker-admin admin --off <email>` clears it.
  `tracker-admin users` shows it.
- The session carries the flag. `GET /api/auth/me`, login, signup and confirm return
  `admin: true` for an admin, and leave the field out for everyone else.
- The app reads the flag on every `/auth/me`, including for a remembered session.
- An MCP token carries no admin rights. Publishing is in the app only.

## 4. Storage

Schema 19 adds one table:

| Column         | Holds                                                                                |
| -------------- | ------------------------------------------------------------------------------------ |
| `id`           | The shared programme's own id (`edits.new_id`).                                      |
| `name`         | The document's name.                                                                 |
| `doc_json`     | The snapshot.                                                                        |
| `rev`          | Bumped by each publish.                                                              |
| `published_by` | The admin's user id, `ON DELETE SET NULL`. Never returned.                           |
| `source_id`    | The admin's library programme it came from. Never returned to anyone but that admin. |
| `published_at` | First publish.                                                                       |
| `updated_at`   | Last publish.                                                                        |

`(published_by, source_id)` is unique, so publishing the same library programme again replaces its
shared copy. Deleting the admin's account leaves the shared library as it is.

## 5. Endpoints

| Method and path                           | Who      | Body               | Answers                                                                                                                                                                                                                                                             |
| ----------------------------------------- | -------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/shared-programmes`              | Any user |                    | `{programmes: [SharedSummary]}`, newest publish first.                                                                                                                                                                                                              |
| `GET /api/shared-programmes/{id}`         | Any user |                    | `{programme: SharedSummary & {doc}}`.                                                                                                                                                                                                                               |
| `GET /api/shared-programmes/{id}/preview` | Any user |                    | `{programme: SharedSummary & {doc}, plan}`: `plan` is a start's preview at the programme's own values from today (K173). Writes nothing.                                                                                                                            |
| `POST /api/shared-programmes/{id}/copy`   | Any user |                    | 201 with the new library programme, as `POST /api/programmes` answers.                                                                                                                                                                                              |
| `POST /api/programmes/{id}/publish`       | Admin    | `{preview?, rev?}` | Preview (default): `{preview: true, rev, publish: {programme: SharedSummary & {doc}, replaces: {id, updatedAt} \| null}}`, where `programme.id` is null before a first publish. Confirm (`preview: false` with `rev`): `{preview: false, shared: {id, updatedAt}}`. |
| `DELETE /api/shared-programmes/{id}`      | Admin    |                    | 204. Copies already made stay.                                                                                                                                                                                                                                      |

`SharedSummary` is `{id, name, description, kind, weeks, activities, updatedAt}`: a library summary
with no `rev`, no `createdAt` and no owner.

- A non-admin gets 403 `not-admin` from publish and unpublish. An unknown id gets 404.
- The publish token covers the library programme's `rev` and the shared copy it replaces. A stale one
  answers 409 `{error: "conflict", rev, preview}`, as a run change does.
- Copy goes through the library's own add: the 100-programme cap (409 `too-many`) and the storage
  quota (413 `quota`) apply, and the copy keeps the shared programme's name.
- For an admin, each library summary from `GET /api/programmes` carries `shared: {id, updatedAt} | null`.
  Nobody else's summaries carry the field.
- Export and import leave the shared library out. It is not any account's data.

## 6. MCP

| Tool                     | Scope | Does                                                                       |
| ------------------------ | ----- | -------------------------------------------------------------------------- |
| `list_shared_programmes` | read  | The shared library's summaries, or one shared programme with its document. |
| `copy_programme`         | write | Copies a shared programme into the caller's library and returns it.        |

An agent then adjusts the copy with `save_programme` and starts it with `start_programme`, as it does
with any library programme. `copy_programme`'s annotation is `ADDING`, as `save_programme`'s.

## 7. Views

John's picks in the mockup `brand/design-system/mockups/261119-shared-library` (K171):

- **Programmes page, Reference tab** (K177, amending K171's section in Library): a fourth tab,
  Started · Library · Reference · Add. Reference has the line "Programmes anyone with an account
  can copy. A copy is yours to change and start.", then one row per shared programme with the
  name, "Kind · N weeks · N activities", the description, **Preview** and **Copy to library**.
  Copy to library asks first (K172): "Copy Strength 5×5 to your library?", "The copy is yours to
  change and start.", **Copy**. When the library already has a programme of that name, the
  question says "Your library already has a programme called Strength 5×5. Copying adds another
  one." After a copy, the row's button reads **Added to library** for the rest of the visit, and
  Library opens with the copy landing (K174): the page scrolls to it, first in the library, focus
  moves to its name, and the row slides in on a `tile` ground that fades after 1.5 seconds. An
  empty shared library says "No reference programmes yet."
- **Preview** (K173, the mockup `261119-shared-preview`, option C): each shared row has **Preview**
  before Copy to library. It opens a Dialog titled with the programme's name: the kind line, the
  description, the line "Eight weeks, at the programme's own values. Deload in weeks 4 and 8. You
  choose your own values and start day when you start your copy.", the ProgrammeGrid by week
  number with no dates, and each activity with its notes and link. **Close** and **Copy to
  library** end it. Copy copies without the row's question, since the Dialog was the look; when
  the library already has a programme of that name, the Dialog says so first. From 640px up the
  Dialog takes the screen's width less 48px each side (K175).
- **The admin's own rows:** a **More** menu on each row holds **Publish**, or, for a shared row,
  **Publish again** and **Unpublish**. A shared row shows a "Published" Chip after its name (K177). Nobody else
  sees the menu's publish items or the chip.
- **Publish:** a Dialog that opens on the preview, "What everyone will see": the name, the kind line,
  the description, and each activity with its notes and link. Under it, "Everyone with an account can
  see and copy it. Your name is not shown." Then **Publish programme**. Publish again says what it
  replaces.
- **Unpublish:** a ConfirmDialog, "Unpublish Strength 5×5?", "It leaves the shared library. Copies
  people have made stay theirs."

## 8. Adjusting a copy

This version had no form editor (programmes spec §13). A user adjusts a copy in two ways:

- the start options: the parameters, the start day and the tracker's name;
- an agent's `save_programme` on the copy.

The programme builder (K183, [2026-11-20-programme-builder.md](2026-11-20-programme-builder.md))
adds a third: Edit on the copy's Library row.

## 9. Demo data

`tracker-admin seed-demo` adds one shared programme when the shared library is empty, so the Shared
tab has something to show locally.

## 10. Not in this version

- An in-app editor.
- A link from a copy to its original, or "updated version available".
- Publishing over MCP.
- Shared programmes from users who aren't admins, ratings or comments.
