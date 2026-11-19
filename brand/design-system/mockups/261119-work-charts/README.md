# Work charts: a programme's work, week by week

**Question:** two questions about the new Work tab on a programme's overview (spec
[2026-11-19-work-charts.md](../../../../docs/specs/2026-11-19-work-charts.md)). (1) How a chart
shows planned and done work week by week. (2) How the tab lays out the whole programme and each
activity. The item page's chart, under the step chart, takes the form picked in (1).

**Status:** decided

**Link:** https://claude.ai/artifact/K9KRBMgBNnhYJ5FAHpWMmq

## Options

No colour is new: done is `pen`, the marks' colour; this week sits on a `tile` band.

### 1. The chart

- **A.** A column per week, outlined at its planned work (1.5px `ink-secondary`, dashed
  `control-border` for weeks to come), filled with `pen` up to the work done. (Recommended: planned
  and done in one glance, week by week.)
- **B.** Lines: planned as a step (solid to this week, dashed after), done as `pen` dots joined by
  a line.
- **C.** Running totals: planned to date and done so far as two rising lines.

### 2. The tab

- **A.** The whole programme, then "By activity" with a chart per activity, two to a row (one on a
  phone). (Recommended: every activity in view, nothing to choose.)
- **B.** The whole programme, then a select choosing one activity at a time.

## Decision

John, 2026-11-19: "A. Columns (Recommended)" and "A. Total + every activity (Recommended)". They
became K180 in `docs/decisions.md`. Round 2 added question 3, a long programme: John picked "A.
Scroll sideways" (K181), not the recommended B, and raised the cap to 156 weeks (K182).

## Rounds

- **1, 2026-11-19:** the first options.
- **2, 2026-11-19:** question 3, a 104-week programme: A, scroll sideways; B, weeks grouped to fit
  (recommended).
