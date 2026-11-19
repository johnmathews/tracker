A programme's work, week by week: a column per week outlined at the work planned and filled to the work done, on the overview's Work tab and an activity's item page.

## Use

- **Where:** two places, one chart (K180, work-charts spec §4). The **Work tab** of a programme's overview (`#/programme/<tracker>`), between Plan and Changes: the whole programme's work, then each activity's. And an activity's **item page**, in its Programme row under the step chart (ProgrammeChart card).
- **What it counts** (K179): work is weight × reps × sets, in kg. An activity without weight counts total reps, or seconds held for a hold; cardio counts distance in km, or time in minutes without one. A chart counts one measure: the total adds the weighted activities only. Every amount is the server's (P4).
- **The column** (K180, option 1A), as an SVG drawn at the chart's own width, so its text stays 16px at every size:
  - **Planned** is the column's outline: 1.5px `ink-secondary` for this week and the weeks before it; dashed `control-border` (5 on, 4 off; 4 on, 3 off when the columns are narrow) for the weeks to come. A week that plans nothing (paused, ended, before the activity starts) has no outline.
  - **Done** fills the column with `pen` from the axis up to the work done. A full column is a week done as planned; a deload is visibly shorter; a week with more marks than its goal fills past its outline (W3). `pen` is used for nothing else here.
  - A column is 56% of its pitch, at most 44px and at least 4px.
- **Every chart of a run lays out the run's grid weeks.** An activity's weeks can be fewer (none before it was added or after it ended): each sits in its place by its Monday, and a week with none keeps its place and its number with no column. So every chart lines up with the total, week for week.
- **This week** sits on a `tile` band (`radius-sm`, inset 2px each side; 1px and 3px corners when the columns are narrow), its number in `ink` at 600. With no week this week (the run has ended, or not started), there is no band.
- **The value axis** at the left, from 0, in steps of 1, 2 or 5 times a power of ten, about four of them, with a 1px `line` rule at each. Its unit sits above it ("kg", "s", "reps", "km", "min"). Ticks use a thousands separator ("15,000").
- **The week numbers** under the plot: "Wk 1", then 2 to the last. When a column has no room for "Wk 1", "Wk" moves to the axis, under its numbers. A week a change split reads "4/5".
- **A long programme** (K181, option 3A): a column per week, never grouped, at least 18px apart. When the weeks don't fit the chart's width, the plot scrolls sideways inside its own box, as the overview's grid does, never the page. The value axis, its unit and "Wk" stay fixed at the left. **It opens with this week in view, about two thirds across**; an ended programme opens at its end, one still to start at its start. A programme may run 156 weeks (K182).
- **Week numbers thin out** to stay apart ("1, 3, 5…", "1, 4, 7…"), each at least 8px from the next. This week's number always shows; a number that would touch it is left out. While the plot scrolls, a number its box's edge would cut is left out too, so "13" never reads "3" beside "Wk".
- **Pointing at a week** tints its column (`ink` at 6% over the ground) and shows its numbers in a small panel (the Popover's skin: `panel`, 1px `line`, `radius-sm`, `shadow-overlay`): "**Week 4** · 16–22 Nov", "Planned 5,650 kg", "Done 2,400 kg so far". A week to come has no Done line.
- **The legend,** in `caption` `ink-secondary`, swatches 18 × 12: Planned (an `ink-secondary` outline), Still to come (a dashed `control-border` outline), Done (`pen`). It sits under the line, over the chart.
- **Sizes:** 300px tall for the whole programme, 200px for an activity's.
- Nothing animates.

## The Work tab (K180, option 2A)

- **"The whole programme"** (22u at 600; 20n folded), its line in `body` `ink-secondary` with the amount in `ink` at 600: "Week 4: **2,400 kg** of 5,650 kg planned. 29,775 kg done so far." Then the legend, the chart (300px), and the line naming what the total leaves out, in `caption` `ink-secondary`: "Plank has no weight, so it is not in the total." ("Plank and Run have no weight, so they are not in the total.")
- **"By activity",** after a 1px `line` rule, then a chart per activity (200px), two to a row with 32u between them, one to a row folded. Each has its name (`label` at 600) and its line in `caption`: a weighted activity's says its work so far, as the total's does; one without weight leaves that out: "Week 4: **105 s** of 315 s planned." An activity without weight names its measure after its name: "Plank, seconds held", "Push-up, total reps", "Run, distance in km", "Run, time in minutes".
- **With no weighted activity** there is no total: the tab starts at "By activity", with the legend under it.
- **With no current week** a line counts the whole programme: "In all: **30,150 kg** of 37,800 kg planned."
- An older server that sends no work leaves the tab out.

## The item page

In the activity's Programme row, under the step chart and its ends-short line, before the activity's controls: "Work" (`label` at 600), the activity's line in `body` `ink-secondary`, the legend and its chart (200px). It is left out while a change is previewed in the plan, and when the server sends no work.

## States

| State                       | Look                                                                          |
| --------------------------- | ----------------------------------------------------------------------------- |
| A week done                 | Outlined in `ink-secondary`, filled with `pen` to the work done               |
| This week                   | On the `tile` band, filled to the work so far, its number in `ink` at 600     |
| A week to come              | A dashed `control-border` outline, no fill                                    |
| A week that plans nothing   | No column                                                                     |
| More weeks than fit         | The plot scrolls sideways, the axis fixed; the numbers thin out               |
| No week this week           | No band; the line counts the whole programme                                  |
| Pointer over a week         | Its column tinted, its numbers in the panel                                   |

## Accessibility

- The plot's SVG is `role="img"` with a label: "The whole programme: work in kg planned and done, week by week", "Plank: seconds held planned and done, week by week". The axis's SVG is `aria-hidden`.
- **A screen reader gets a table** with every week's numbers: the label as its caption, and a row per week (Week 4, 16–22 Nov · 5,650 kg · 2,400 kg so far). It sits in a visually hidden box. A table ignores a 1px width of its own, so the box, not the table, carries the hiding.
- The plot takes focus (a 2px `focus` outline inside its edge, so a scrolling box doesn't clip it). The arrows, Home and End move between weeks and show each week's numbers in the panel, scrolling a long plot to keep the week in view. The panel is for a pointer and a keyboard only and is never needed: the table carries every number.
- The legend's swatches are `aria-hidden`; its words stay.
- Contrast, measured by the gate in both themes: the `pen` fill on `canvas` and on the `tile` band, the `ink-secondary` outline, and the `control-border` dashes (3:1 as a mark, on `canvas` and `tile`).

## For the app

`src/components/ui/work-chart/`: `WorkChart` and `WorkLegend`. The words are `src/lib/work.ts`'s; the Work tab is `ProgrammeWork`; the item page's section is `ItemProgramme`'s. Test ids, as in the preview:

| Element                                     | Test id                                                      |
| ------------------------------------------- | ------------------------------------------------------------ |
| The plot's SVG, its scrolling box           | `work-chart`, `work-chart-plot`                              |
| The table, the panel, the legend            | `work-chart-table`, `work-chart-tip`, `work-chart-legend`    |
| The Work tab, its tab                       | `programme-work`, `programme-tab-work`                       |
| The total's chart, line, left-out line      | `work-total`, `work-total-line`, `work-left-out`             |
| "By activity", an activity's chart and line | `work-by-activity`, `work-activity`, `work-activity-line`    |
| The item page's section and line            | `activity-work`, `activity-work-line`                        |

## You provide

From the run's `work` (spec §3): the series's unit and, per week it has, its Monday, its programme weeks, the amount planned and the amount done (null for a week to come); the run's grid weeks to lay them on; this week's Monday; the height; the label. For the tab and the item page, each activity's key, name and measure, and the names the total leaves out.
