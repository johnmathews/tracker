# Work charts

> Purpose
>
> How a programme, and each activity in it, shows the work planned and the work done, week by
> week. It is the authority for the build, after the mockup round in §6.

**Status:** approved by John on 2026-11-19, views picked the same day (K179–K181). Answers taken from John on 2026-11-19: work is weight × reps ×
sets; any mark counts a session's full planned work; activities without weight have no work but
count total reps or seconds held; the charts live on the overview's own tab and on each
activity's item page.

## 1. Terms

- **Session:** one day an activity is planned for, by its goal ("3 a week" is three sessions).
- **Work:** a session's weight × reps × sets, in kg. An activity done on each side counts both
  sides, so its reps double.
- **Measure:** what an activity's chart counts. A weighted activity counts work in kg. One without
  weight counts total reps (reps × sets), or total seconds held (seconds × sets) for a hold. A
  cardio activity counts distance in km, or time in minutes when it has no distance.
- **Planned:** a week's sessions × each session's amount, from the plan as it stands.
- **Done:** the sum, over the week's marked days, of that day's planned amount for one session.

## 2. Rules

- **W1. Any mark counts in full.** A day marked great, partly done or too difficult adds the
  session's full planned amount, as any mark counts toward the goal today. Marks say how a day
  went, not what was lifted.
- **W2. The day's own values.** A value changed within a week (a split, K163) counts from the day
  it started: a marked Thursday after a change from Wednesday counts the new value.
- **W3. More marks than the goal count.** A fourth marked day in a "3 a week" week adds a fourth
  session, so done can pass planned.
- **W4. The server computes it** (P4), from the run's grid and marks, as it computes every plan
  value. The app draws what it is sent.
- **W5. One measure per chart.** Amounts in different measures are never added. The programme's
  total counts work only, over its weighted activities, and names the ones it leaves out.
- **W6. Paused and ended weeks plan nothing.** A paused activity's paused days have no sessions;
  an ended one's weeks after its end are left out.

## 3. The data

The run (`GET /api/runs/{tracker}`, and every reply that carries a run) gains `work`:

```json
"work": {
  "total": {"unit": "kg", "leftOut": ["Plank"],
            "weeks": [{"monday": "2026-11-02", "programmeWeeks": [3], "planned": 4725, "done": 3150}]},
  "activities": [
    {"key": "squat", "name": "Back squat", "measure": "work", "unit": "kg",
     "weeks": [{"monday": "2026-11-02", "programmeWeeks": [3], "planned": 2025, "done": 1350}]},
    {"key": "plank", "name": "Plank", "measure": "seconds", "unit": "s", "weeks": []}
  ]
}
```

- `weeks` follows the grid's calendar weeks, in order, one entry per grid week (`monday` and
  `programmeWeeks` as the grid's). A week after an open pause has no dates, so it is left out.
- `measure` is one of `work` (kg), `reps`, `seconds` (s), `distance` (km) and `time` (min).
- A week's **planned** is the sum over its days of (the day's goal ÷ 7) × the day's amount for one
  session, on the days the activity runs: the goal × the amount when nothing changes mid-week,
  and the day's own values when something does (W2). Paused, ended and before-start days add
  nothing (W6).
- A week's **done** is the sum over its marked days of the day's amount for one session (W1, W3).
  A week wholly after today has `done: null`; this week counts its marks so far.
- Amounts are rounded to whole kg, reps, seconds and minutes, and to 0.1 km.
- `total` adds the `work` activities only; it is null when none has weight, and `leftOut` names the
  others in the grid's order.
- An activity's amount for one session: `work` weight × reps × sets; `reps` reps × sets; `seconds`
  seconds × sets; `distance` the distance; `time` the duration in minutes. Each side (`perSide`)
  doubles reps and seconds.

## 4. Where

- **The overview** (`#/programme/<tracker>`) gains a tab, **Work**, between Plan and Changes: the
  programme's total, then each activity's own chart.
- **An activity's item page** shows its own work chart in the Programme row, under the step chart.

## 5. Words

- The total's line: "Week 4: **3,150 kg** of 4,725 kg planned. 12,400 kg done so far."
- An activity without weight: "Week 4: **180 s** of 270 s planned."
- Left out: "Plank and Run have no weight, so they are not in the total."
- Amounts use a thousands separator and no decimals for kg, reps and seconds; km keeps one
  decimal.

## 6. Views

John's picks in the mockup `brand/design-system/mockups/261119-work-charts` (K180):

- **The chart** (option 1A): a column per week, outlined at its planned amount (1.5px
  `ink-secondary`; dashed `control-border` for the weeks to come), filled with `pen` up to the
  amount done. This week sits on a `tile` band; the value axis at the left with its unit above it;
  "Wk 1" to the last week under the plot, this week's number in `ink` at 600. A legend over it:
  Planned, Still to come, Done.
- **The Work tab** (option 2A): "The whole programme" with its line, legend, chart (300px tall)
  and the left-out line; then "By activity", a smaller chart (200px) per activity with its name and
  line, two to a row, one folded. With no weighted activity, the tab starts at "By activity".
- **The item page:** the activity's own chart, as on the tab, under the step chart in its
  Programme row, headed "Work" with its line.
- **A long programme** (option 3A, K181): a column per week, never grouped. Columns sit at least
  18px apart; when the weeks don't fit the chart's width, the plot scrolls sideways inside itself,
  as the overview's grid does, and opens with this week in view (about two thirds across). The
  value axis and its unit stay fixed at the left. Week labels thin out to stay apart ("1, 4, 7…"),
  and this week's number always shows. A programme may run up to 156 weeks (K182).

## 7. Not in this version

- Recording what was actually lifted on a day.
- Work for an ordinary (non-programme) tracker.
- A body weight setting, to give bodyweight exercises work in kg.
