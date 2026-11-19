# Work charts, and P for Programmes

> Purpose
>
> Records the work of 2026-11-19 and 2026-11-20: charts of the work a programme plans and the
> work done, a 156-week cap, and P as the Programmes key. The decisions are K178 to K182.

## 1. What changed

- **P opens Programmes on the week (K178).** P was Print (K91). Print keeps its button; ⌘P or
  Ctrl+P is the browser's own print.
- **Work, planned and done (K179).** The server counts each programme week's work and sends it
  with the run, as `work` (spec `docs/specs/2026-11-19-work-charts.md`, module
  `api/src/tracker_api/work.py`). Work is weight × reps × sets, in kg. An activity without weight
  counts total reps, or seconds held for a hold; cardio counts distance, or time without one. A
  marked day counts its session's full planned amount, whatever its mark, as goals count marks.
  `get_programme` over MCP carries the same `work`.
- **The charts (K180, K181).** A new component, WorkChart: a column per week, outlined at the
  planned amount and filled with `pen` up to the amount done; the weeks to come dashed; this week
  on a `tile` band. The overview gains a Work tab between Plan and Changes: the whole programme's
  work, then a chart per activity in its own measure. Each activity's item page shows its chart
  under the step chart. A long programme keeps a column per week and scrolls sideways, opening on
  this week, with the axis fixed at the left. John picked the sideways scroll over grouping weeks.
- **156 weeks (K182).** A programme may run three years. `every` and a pause's `weeks` keep 1 to
  52, so the old shared constant split in two (`MAX_WEEKS`, `MAX_SPAN`).

## 2. Calls made for John

- Cardio counts distance, or time when a session has no distance. He named reps and seconds only.
- An activity's weeks run from when it was added to when it ended, so its list can be shorter than
  the grid's. The app lines every chart up by Monday, so all charts keep the same columns.
- Planned follows the spec's formula (each day's goal ÷ 7 × that day's amount), without K163's
  rounding up. A part-paused week can therefore plan a little less than the grid's goal suggests.
- An activity without weight says this week's amount but not its total so far (spec §5); a
  weighted one says both.

## 3. Found on the way

- Two agents built the server and the app in parallel, against the spec's data shape. The app
  agent built its tests on a hand-made fixture and switched to the regenerated e2e fixtures once
  the server was done.
