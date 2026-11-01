# The insights module

> Purpose: why the API now has `insights.py`, how it is kept in step with the screen, and what the
> MCP session relies on. It is W1 of the /ask plan, and lands in its own PR first.

## 1. Why

John asked for an /ask page, where Claude says whether he is doing too much or too little for his
goals. Another session is building an MCP server that answers the same kind of question. Both
need one read-only view of his data, and that view must agree with the screen. Until now the
carry-forward rule, the default plans and the goal and met-day rules existed only in TypeScript.
Some of them lived inside components. An AI reading the raw tables could say "goal missed" for a
week the screen shows as met.

## 2. What was built

- **`metDays(counts, target)` in `src/lib/tracker.ts`.** `ExerciseGrid` and `DietSection` call it
  instead of their inline `n >= pick`. The component specs did not change and stay green. That is
  the proof that the move kept the screen as it was.
- **`api/src/tracker_api/insights.py`.** First the pure rules, ported one for one:
  `plan_source`, `week_items`, `default_items`, `total_for`, `day_counts`, `goal_met`,
  `goals_met`, `met_days`, plus `is_monday` and `monday_of`. Then five readers: `week_summary`,
  `weeks`, `item_history`, `goals` and `consistency` ([api.md](../docs/api.md) §1.1).
- **`fixtures/insights/`.** Eleven cases, one per file, each with what the screen shows.

## 3. Decisions

- **`today` is always an argument.** The server can't know the browser's date (week keys are local
  dates), so the module never reads the clock. The plan's `goals(conn, user_id)` gained `today`
  for the same reason: the goals are those of the week that today falls in.
- **Kinds, not drawings.** An item's `marks` holds `great`, `partial`, `missed` or None. The drawing
  says nothing about the work done.
- **Missed days count, and say so.** `done` counts every mark, as the goal does on screen. Beside
  it sit `great`, `partial` and `missed`, so a week of red marks can't read as plain success.
- **A week without its own plan is `carried`**, whether it shows another week's plan or the
  defaults. `plan_week` is None for the defaults.
- **An item missing from a week's plan reads as empty in that week.** Its marks stay in the log,
  but the screen doesn't count them, so `item_history` doesn't either.
- **Bounds.** Names are cut to 100 characters and notes to 500 in the output, counted as code
  points. A week count is 1 to 26. Week keys must be real Mondays: `is_week` checks only the
  shape.
- **Refusals are `InsightsError`**, a `ValueError` with `field`, so a tool can tell the model which
  argument to fix.
- **`TypedDict` return types.** They stay plain dicts at runtime, and a tool layer can read the
  shape from the annotations.
- **`consistency` judges goals on finished weeks only.** A week whose Sunday is before today is
  finished. Today's week counts towards met days up to today. Today doesn't break the run of met
  days until it is over.
- **`goals()["note"]` is `""`.** W3 adds the "My goals" field in Settings and fills it in.

## 4. How parity is kept

The fixture files are the contract. Each case gives a section's plans and log, the week, today
and the daily target. It expects the plan week, the day counts, the met days, the days still to
come and each item's counts.

- `src/lib/__tests__/insights-parity.spec.ts` runs each case twice. Once through `planSource`, the
  defaults and the tracker helpers. Once through the real planner and diet stores, at the case's
  date, which checks the screen's own path: its items, its counts and its future days.
- `api/tests/test_insights.py` runs each case through the pure rules, and through `week_summary`
  over a real database loaded by `import_data`.

Changing one expected value (`daysMet` in `met-days.json`, 3 to 4) failed both suites:
`expected 3 to be 4` in Vitest, and `assert 3 == 4` in two pytest cases.

## 5. What the MCP session relies on

- The five reader signatures, each `(conn, user_id, …, today)`, and the pure rules.
- JSON-able dicts, snake_case keys, Monday `YYYY-MM-DD` weeks, and no user or session fields.
- Reads only: no reader writes, and each reads only its `user_id`'s rows.
- Sections are `exercise` and `diet`, as stored. The tracker-types run keeps those values.
- `InsightsError` for a bad argument, with `field`.

## 6. Left for later

- An exercise's reps, sets, duration and weight are not in the output; the plan's shape didn't
  list them. They would help answer "am I doing too much", and adding them won't break a caller.
- Item ids are not cut, since `item_history` looks items up by them. Plans are bounded by the
  quota.
- When the tracker-types run moves plan-item notes into `item_details`, `notes` here has to read
  from there.
