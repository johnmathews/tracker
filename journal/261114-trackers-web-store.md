# The web app's trackers store, sync and export version 6 (W6)

> Purpose
>
> Records how unit W6 of the 2026-11-14 run moved the web app onto trackers the account owns
> (K123, spec `docs/specs/2026-11-14-account-trackers.md` §5): the calls the spec left open, and
> what is left for W7's screens.

## 1. What changed

- `src/lib/trackers.ts` is new: the tracker's shape and the API's rules for it (`normaliseTracker`,
  `showsIn`, `inOrder`, `nextPosition`, `firstTrackers`).
- The registry's `exercise` kind is `strength`, with a per-kind `dailyTarget`, `normalise` and
  `FIRST_NAMES`; `itemSections` reads an old `exercise` key as `strength`.
- One `trackers` store replaces the planner's exercise data and the cardio and diet stores. The
  planner keeps the week, the mode, the mark set and the settings. The details store is keyed by
  tracker id.
- Sync's state, snapshot, revisions and operations are keyed by tracker id, with
  `tracker-create`, `tracker-patch` and `tracker-end`. The cache and outbox are `-v6`. A `-v5` or
  older cache maps onto the first three trackers (`legacyState`), and its outbox moves as it is.
- Export and import are version 6 (`parseExport` ports `validate.parse_export`). The parse
  fixtures W4 turned red pass. `fixtures/transfer/sample/storage-v6.json` is new.
- Routes take any tracker id; App checks it against the loaded trackers. `#/new-tracker` is a
  route value with no page yet.

## 2. Calls the spec left open

- A new tracker starts in the week on screen, as Delete ends from the week on screen (K122). K124's
  page says "Starts: This week"; W7 can pass another week if John reads it as today's.
- A daily target is a `tracker-patch`. Settings writes still send `dailyPick` and `foodPick`, read
  from the `exercise` and `diet` trackers, because the API resets a missing `dailyPick` to 3.
- A patch sends name, position and daily target together, guarded by the revision. A conflict
  takes the server's copy, with "A tracker was changed on another device…", except at revision 0
  (a cache from before trackers): the change goes again at the server's revision.
- After a create, the server's position is taken, and anything changed meanwhile is queued as a
  patch or an end.
- The import summary counts trackers the file adds ("one tracker") and skips data for a tracker
  the account has as another kind, as the API does.

## 3. Left for W7

- The screens still draw the three fixed sections (ExerciseGrid, CardioSection, DietSection),
  reading the trackers store by id, with their old headings ("Exercises"). `trackers.shown` is
  ready for one `TrackerSection` per tracker shown.
- `#/new-tracker` shows the week. Back from a new item page of a tracker other than the first
  three has no Add button to focus.
- Nothing on screen calls `createTracker`, `renameTracker` or `endTracker` yet.
