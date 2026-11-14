# Account trackers: from three fixed sections to trackers each account owns

> Purpose
>
> Records the 2026-11-14 run that made trackers the account's own data (K122 to K126, the spec
> `docs/specs/2026-11-14-account-trackers.md`), unit by unit, with the calls made on the way and
> what a later run picks up. The web data layer's own notes are in
> [261114-trackers-web-store.md](261114-trackers-web-store.md).

## 1. What changed

- **W4, the API.** A `trackers` table (migration 16) backfills `exercise`, `cardio` and `diet` for
  every user, with a trigger for new users. The kind `exercise` became `strength`. New endpoints
  create, patch and end a tracker; plan, tick and details writes take any tracker id the user has.
  `/api/state` and export version 6 carry `trackers` and data by tracker id, and still send the
  old `exercise`, `cardio` and `diet` keys for tabs on older code.
- **W5, the Claude tools and Ask.** `list_trackers` is new. Every tool takes `tracker`, an id or a
  name in any case, with `section` kept as an alias. Ask's prompt lists the trackers the week shows.
- **W6, the web data layer.** One `trackers` store, sync keyed by tracker id with three new
  operations, cache and outbox `-v6`, export version 6.
- **W7, the screens.** One `TrackerSection` per tracker shown replaces ExerciseGrid,
  CardioSection and DietSection. The title line in Edit plan holds the pen, the daily target, Add
  and Delete tracker; the bar holds Add tracker, which opens `NewTrackerPage`. Ids follow the
  tracker: `tracker-<id>-heading`, `<id>-grid`, `add-<id>`, `rename-<id>`, `delete-<id>`,
  `to-<id>`, `back-to-<id>`. The registry gained each kind's `label`, `records`, `itemsLabel` and
  `addLabel`.
- **W8, the mobility kind.** Strength's plan without weight, strength's marks, a daily target of 3
  kept on the tracker only, strength's item-page fields. The registry gained `plan` (which fields
  an item has) and `weighted`, so PlanFields, the item page and the new item page read the kind
  rather than test for `strength`. The API drops a weight from a mobility item, and the MCP tools
  refuse `weight_kg` for one.
- **W9, docs and end-to-end tests.** The e2e mock now answers `/api/state` as version 6 and keeps
  tracker, plan, mark and details writes. Since W6 it had answered in version 5, which the app no
  longer adopts, so the app ran on its v3 cache and lost the mocked notes. A new
  `trackers.spec.ts` drives Add tracker, the pen, Delete tracker and a mobility item end to end.

## 2. Calls made on the way

- **K125.** A new tracker starts in the week on screen, the same week Delete tracker ends from.
  An account holds at most 100 trackers, deleted ones included.
- **K126.** Mobility's fields, marks and words. Its row label is "Exercise" and its Stepper says
  "Exercises a day", so the new item page reads "New exercise" under "Add mobility". The kind's
  line is the mockup's: "sets, then reps or a hold time, each side if you like."
- **P25** is marked superseded by K123: a second tracker of a kind is a tracker, not a section.
- The v6 parse fixtures had used `mobility` as the example of a kind the registry lacks. Once it
  existed they use `yoga`, and `v6-sections.json` gained a mobility tracker whose item's weight
  drops.
- The first W9 e2e run had docs edited while it ran, and several of its pages lost their
  execution context mid-test, as on a reload. Keep the tree still during a run.

## 3. Left for a later run

- Reordering trackers on screen: the API takes a position, the screens don't offer it yet.
- Bringing a deleted tracker back.
- Dropping `settings.dailyPick` and `foodPick` and the old `/api/state` keys, once no tab on
  version 5 code can be live.
