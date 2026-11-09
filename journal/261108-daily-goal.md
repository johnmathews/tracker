# A Daily goal switch, and the date as the week's title

On 2026-11-08 John asked for "an option in settings to hide the "- N per day +" element ... called
"daily goal"", then, mid-run, for the date to be the week screen's title: "it is the title, and the
tracker type ("exercises" or "food") is more of a section heading". The mockup
`brand/design-system/mockups/261108-daily-goal` settled both: K85 and K86.

## What John decided

- **K85:**
  - One switch for both sections, saved with the account, on by default.
  - While it is off, Ask and the AI connections ignore the daily targets.
  - It sits in Settings › Your goals (A), as he also wrote: "daily goal should be in the "your
    goals" section".
- **K86, T1:** the date is centred at the top of each week screen, in the title serif, in `ink`.
  "Exercises" and "Food" become sans headings at max(22px, 27u), in Edit plan too.
- **K87, H1:** after seeing T1 running, John asked for "Exercises" to be "more like a title ... a
  serif font and a bit larger". Round 3 settled it: the serif at max(26px, 32u), the date
  unchanged at 40u.

## How

- **App.** `dailyGoal` is optional in `PortableSettings`, and missing reads as on. It sits beside
  `goalsKnown` as `dailyGoalKnown`. A tab sends it only once it knows it. This is the F1 rule for
  goals: a cache from before the switch must not turn it back on. Off, the grids pass no met days
  and Edit plan renders no Stepper. The picks are kept.
- **API.**
  - The work was done by a subagent in the same worktree, then reviewed.
  - Schema 13 adds `settings.daily_goal` (0 or 1, default 1). A `PUT /settings` without a boolean
    `dailyGoal` keeps the saved value.
  - While the switch is off, `insights` returns null for the daily target and every met-day field
    (never false or 0), so no reader sees "0 met days". Item goals are untouched.
  - The Ask prompt and the MCP tool descriptions say what the nulls mean.
- **Parity.** Two shared parse fixtures, `daily-goal.json` and `daily-goal-not-a-boolean.json`,
  pin how both languages read the key.
- **Title.** `SectionHeader` sets the week as a centred `title-1` row across its grid (folded too)
  and the title in the same serif at the new `--fs-section` (32u; K87). `--fs-week` went. Print is unchanged.

## Checks

- Each new test failed first:
  - the three Daily goal tests in `SettingsAsk.spec.ts`, against the old Settings page and grid;
  - the two SectionHeader tests, against the old component;
  - the API's thirteen, run by the subagent.
- Screenshots of the week, Edit plan and Settings at 1280 and 390 matched the mockup.
