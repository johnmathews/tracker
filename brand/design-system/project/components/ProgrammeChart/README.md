An activity's Programme row on its item page: a step chart of the planned value week by week, with what was done on top, and the activity's own controls.

## Use

- **Where:** the ItemPage of an item in a programme tracker, as its first row, where "This week's plan" sits for an ordinary item (spec §9.4). The row is ItemPage's (K65): the heading "Programme" in the 320u name column, the content at its right; folded, the heading over the content. The rows after it (Notes and the rest) are ItemPage's, unchanged.
- **The lede,** in `body` `ink-secondary`, with the value in `ink` at 600: "This week is a deload: **45 kg**, 3 × 5. It goes up 7.5% a week." Paused: "Paused since Mon 14 Dec. Knee. It comes back on Mon 28 Dec at **75 kg**."
- **The legend** over the chart, in `caption` `ink-secondary`: Planned (a solid `ink` line), Still to come (a dashed `ink-secondary` line), Goal met (a `pen` dot), Goal not met (a ring in `ink-secondary` on `canvas`).
- **The step chart** (K145), as an SVG drawn at the chart's own width, so its text stays 16px at every size. 290px tall, 240px folded.
  - One column per programme week, numbered under the plot ("Wk", then 1 to 8), this week's number in `ink` at 600. This week's column sits on a `tile` band (`radius-sm`).
  - The value axis at the left, its unit above it ("kg", "s", "km"), in steps of 10 with a 1px `line` rule at each.
  - **The planned value is a step per week:** a 2px line in `ink` up to the end of this week, then dashed (6 on, 5 off) in `ink-secondary` to the last week. The step up into next week is drawn once, dashed.
  - **What was done, on top:** a dot at each week done so far, at that week's value. A week that met its goal is a `pen` dot (7px radius, a 2px `canvas` ring round it). One that didn't is a ring (6px, 2px `ink-secondary`, filled `canvas`) with "1 of 3" under it in `caption` `ink-secondary`. `pen` is used for nothing else here.
  - **A pause leaves a gap:** no line through its weeks, a dashed `control-border` line at each end, and "Paused" with the reason between them, in `caption` `ink-secondary`.
  - **A change** draws a dashed `control-border` line where it took effect (between the days of its week, by its from day), labelled above the plot in `ink` at 600: "7.5% a week, from 3 Dec". The label sits right of the line, or left when it would run off the chart.
  - **Two values are written** above the line in `ink` at 600: this week's and the last week's.
  - **Pointing at a week** tints its column (`ink` at 6% over the ground) and shows its numbers in a small panel (the Popover's skin: `panel`, 1px `line`, `radius-sm`, `shadow-overlay`): "**Week 4** · 14–20 Dec", "45 kg, 3 × 5, deload", "1 of 3 so far".
- **The ends-short line:** an activity that will end before the programme because of a pause gets an InlineMessage (info) under the chart: "Deadlift ends at its week 6 of 8, because of its pause."
- **The activity's controls,** secondary Buttons with Lucide icons, named for the field (spec §9.4): **Set weight** (Set reps, Set time for an activity without weight; `pencil`), **Set increase** (`trending-up`), **Pause activity** (`pause`) or **Resume activity** (`play`) while it is paused, and **End activity** (`circle-stop`). Each opens the ChangeSheet with that change chosen, from today. Folded they sit two to a row, and a label too long for its half wraps inside its button.
- **Offline,** the controls are disabled, with one InlineMessage (info) above them saying why (spec §11.2).
- **Kinds:** a strength activity charts its weight in kg, or its reps when it has no weight; mobility its reps or its time in seconds; cardio its time or distance. The axis unit and the control's name follow.

## States

| State | Look |
| --- | --- |
| Running | The line solid to this week, dashed after; dots for the weeks done |
| A change of value or increase | A labelled dashed line where it took effect |
| Paused | A gap with "Paused" and the reason; Resume activity in place of Pause activity; the lede says when it comes back |
| Ends short | The InlineMessage under the chart |
| This week | The `tile` band; "1 of 3" under its dot until the goal is met, then a `pen` dot |
| Pointer over a week | Its column tinted, its numbers in the panel |

## Accessibility

- The SVG is `role="img"` with a label: "Back squat: planned weight for each week, with the weeks done so far".
- **A screen reader gets a table** with the same numbers: a caption ("Back squat, week by week") and a row per week (Week 4, 14–20 Dec · 45 kg, 3 × 5 · 1 of 3 so far). It sits in a visually hidden box. A table ignores a 1px width of its own, so the box, not the table, carries the hiding.
- The panel on pointing is for a pointer only and is never needed: the table and the grid on the overview carry every number.
- The legend's swatches are `aria-hidden`; its words stay.
- Contrast, measured by the gate in both themes: the `pen` dot on `canvas` and on the `tile` band (3:1 as a mark), `ink-secondary` for the ring and the dashed line, `control-border` for the change lines (3:1), `ink` on `tile` for the line across this week's band.

## For the app

`src/components/ui/programme-chart/` (W8), and the ItemPage's Programme section. Test ids, as in the preview:

| Element | Test id |
| --- | --- |
| The row | `programme-section` |
| The lede, the legend | `programme-lede`, `programme-chart-legend` |
| The SVG, its table, the panel | `programme-chart`, `programme-chart-table`, `programme-chart-tip` |
| The ends-short line | `activity-ends-short` |
| The controls | `activity-controls`, `activity-set-value`, `activity-set-increase`, `activity-pause`, `activity-resume`, `activity-end` |

## You provide

From the run's grid (spec P4): the activity's name, field and unit; per programme week its number, dates, whether it is a deload, the planned value and sets (or that it is paused, with the reason), and for each week done so far the count done against the goal; which week is this week; each change with its position (the week and the fraction of it before the from day) and its label; the pause's weeks; whether it ends short and the sentence that says so; the lede.
