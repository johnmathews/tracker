# Account trackers

> Purpose
>
> The model for trackers each account owns (K123): what a tracker is, how one is created, renamed
> and deleted without losing history, and what changes in the API, sync, export and the Claude
> tools. It is the authority for units W4 to W8 of the 2026-11-14 run. The map of what assumes
> today's fixed three is in that run's evaluation report.

**Status:** draft for John's review (2026-11-14). The screens wait on the mockup
`261114-add-tracker`.

## 1. What a tracker is

- A tracker belongs to one account. It has an **id**, a **name**, a **kind**, a **position** in the
  week, an optional **daily target**, and the weeks it covers.
- The **kind** decides what an item records, how a press marks a day, and whether the tracker has
  a daily goal. A kind is code; a tracker is data. The kinds are:

  | Kind | Records | Marks | Daily goal |
  | --- | --- | --- | --- |
  | `strength` (was `exercise`) | sets, reps or time, each side, weight | great, partial, missed | yes |
  | `cardio` | time, distance | great, partial, missed | no |
  | `food` | times a week | eaten | yes |
  | `mobility` (W8) | sets, reps or hold time, each side; no weight | great, partial, missed | yes |

- A kind is set once. Changing it would leave items recording fields the new kind doesn't have.
- **Ids.** Each account's first three trackers keep today's section names as their ids:
  `exercise`, `cardio` and `diet`. Every stored row, URL, cached op and export already uses them,
  so nothing moves. A new tracker gets a random id from the same generator as item ids
  (`newId`), which can never collide with those three.
- **Names.** The first three are named "Strength", "Cardio" and "Food". A name is 1 to 60
  characters and need not be unique.

## 2. The weeks a tracker covers

- `start_week` is the Monday of the week it was created in. It is null for the first three, which
  have always existed.
- `end_week` is the first week it no longer shows in. It is null while the tracker is live.
- A tracker shows in week W when `start_week <= W` (or there is none) and `end_week > W` (or
  there is none). This one rule decides the week view, Edit plan, print, the Claude tools and Ask.
- **Delete tracker** (K122) sets `end_week` to this week's Monday, whichever week is on screen.
  This is John's "removing the tracker from future weeks, and this week". Its plans, marks and
  notes stay, and earlier weeks still show it, with its item pages.
- A tracker created and deleted in the same week shows nowhere. Its row stays, since import never
  deletes.
- Nothing brings a deleted tracker back in this run (plan non-goal).

## 3. Storage (W4)

- **New table** `trackers (user_id, id TEXT, kind TEXT, name TEXT, position INTEGER,
  daily_target INTEGER NULL, start_week TEXT NULL, end_week TEXT NULL, rev INTEGER, PRIMARY KEY
  (user_id, id))`.
- **The migration** backfills three rows per user:
  - `exercise` → `strength`, named "Strength", `daily_target` from `settings.daily_pick`;
  - `cardio` → `cardio`, named "Cardio", no target;
  - `diet` → `food`, named "Food", `daily_target` from `settings.food_pick`.
- `plans`, `ticks` and `item_details` don't change. Their `section` column now holds a tracker
  id, and writes check that the tracker exists for the user.
- **Daily targets** live on the tracker. `settings.daily_pick` and `food_pick` are kept and
  written in step with the `exercise` and `diet` trackers, so an older tab still reads them. A
  later run drops them.
- **The kind rename** `exercise` → `strength` also renames the key in each stored
  `settings.item_sections`, with a down-migration. Item-page arrangements stay keyed by kind
  (P29), and mobility starts with the default.

## 4. The API (W4, W5)

- **Endpoints:**
  - `GET /api/trackers`
  - `POST /api/trackers` (name, kind)
  - `PATCH /api/trackers/{id}` (name, position, dailyTarget; `rev` guarded like plans)
  - `POST /api/trackers/{id}/end`

  An unknown id is 404 `not_found`; a kind the registry lacks is 400 `invalid`.
- **The section path parameter** becomes a tracker id. It is checked against the user's trackers,
  not a fixed enum.
- **`/api/state`** gains `trackers`. Per-tracker data moves under `sections: {<id>: {plans, log,
  revs}}`, and `details` is keyed the same way. `settings` keeps the global settings. The old
  top-level `exercise`, `cardio` and `diet` keys are still sent while a cached v5 client can be
  live, then removed in a later run.
- **Export v6:** `{version: 6, trackers: [...], sections: {<id>: {...}}, details, settings}`.
  - Importing v1 to v5 maps their fixed keys onto the three original ids.
  - Importing v6 adds trackers missing by id and merges data by id. Import never deletes, and
    never ends a tracker.
- **Claude tools (W5):**
  - A new `list_trackers` tool, with each tracker's id, name, kind, daily target and weeks.
  - Every tool that took `section` takes `tracker`: an id, or a name matched without regard to
    case. `section` stays as an alias for `exercise`, `cardio` and `diet`.
  - `set_daily_targets` takes a tracker and a number.
  - `goals` reports per tracker.
  - The server instructions describe "your trackers" rather than three named ones.
- **Ask:** the prompt lists the user's trackers in the week with their kinds. The tool schema
  takes a tracker id.
- **Default items:** an account with no plan still gets today's default exercises and foods, on
  the `exercise` and `diet` trackers only. A new tracker starts empty.

## 5. The web app (W6, W7)

- **One `trackers` store** holds the list and, per tracker, its plans, log, revs and goal
  actions. Planner keeps the app-wide state: the week, the mode, the mark set and settings. The
  cardio and diet stores go. Details are keyed by tracker id.
- **Sync:** ops carry a tracker id in `section`, and three new ops cover `tracker-create`,
  `tracker-patch` and `tracker-end`. Cache and outbox move to v6. A v5 outbox replays unchanged,
  because its sections are the three original ids.
- **Routes:** `#/item/<tracker>/<item>` and `#/new/<tracker>`, as today, are checked against the
  loaded trackers once sync has loaded. `#/new-tracker` opens the new tracker page.
- **Screens:**
  - One `TrackerSection` per tracker shown this week, in position order. It replaces
    ExerciseGrid, CardioSection and DietSection.
  - Heading ids become `tracker-<id>-heading`. Each screen's arrows go to the next and previous
    trackers shown. Each tracker prints on its own page (K97).
  - The skip link goes to the first tracker.
  - In Edit plan the title line holds the tracker's pen (rename), its daily target, Add and
    Delete tracker. Add tracker goes where the mockup's pick says.
- **The Add button's words** come from the kind: "Add exercise" for strength, "Add cardio",
  "Add food" and "Add mobility". They are kind data, like the item label.

## 6. Not in this run

- Reordering trackers on screen. The API takes a position, so a later screen can use it.
- Bringing a deleted tracker back.
- Dropping `settings.daily_pick` and `food_pick`, and the old `/api/state` keys.
