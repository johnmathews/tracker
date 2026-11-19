# Programmes follow-ups

> Purpose
>
> Records the programmes follow-up run of 2026-11-18 and 2026-11-19 (engineering-team run
> `manual-20261118T220813Z`): issues #83, #84 and #86, plus two fixes John asked for while looking
> at the local preview. The decisions are K163 to K166.

## 1. What changed

- **A split week's goal counts its days (#86, K163).**
  - An item's goal for a calendar week is the sum of each day's target over 7, rounded up. A day
    the activity isn't running counts 0: paused, before the start, or from End programme's day on.
  - `week_goal` in `programme_replay.py` is the one place the rule lives. The week's plan row and
    the grid's cells both call it, so the week view, history, insights, Ask and the MCP read tools
    all read the same goal.
  - John's squat (3 a week, done Monday and Tuesday, paused from Wednesday) reads "2 of 1", met.
    Before, every reader showed "2 of 0", and the grid hid it as "Paused".
  - A week already written is rewritten on each day's first seal, so a week split before the
    deploy picks up the rule. Past weeks are never rewritten.
  - A run started mid-week now has a smaller first-week goal (Friday start at 3: goal 2). John
    chose that, start weeks included.
- **End, restart and re-open through MCP (#83).**
  - `end_programme` previews, then ends the run on a confirm with the preview's rev (K156).
  - `restart_programme` starts the run's own copy again from week 1 as a new tracker, and ends a
    run still going from the day before (K164). It works after the library programme is deleted.
  - `reopen_programme` lifts an End programme: a `reopen-programme` log row, and the days between
    replay as a programme pause, so the run resumes at the week it stopped in (K165, amends
    K156). The weeks hidden behind the end are rewritten as paused, which John confirmed is fine
    under P1.
  - Every confirm checks its token inside the write transaction.
- **Style guide sections (#84).** ProgrammeGrid, ChangeSheet and ProgrammeChart have sections built
  from browser-made example data, and `src/styleguide/__tests__/complete.spec.ts` fails while a
  `src/components/ui/` folder has no section.
- **A mid-week resume read as still paused (found by John on the preview).** A sealed paused day
  keeps the "until" it was planned with, and the week's cell used it. `_back_on` in `data.py` ends
  the cell's pause on the day the activity runs again, so the item page offers Pause activity and
  the grid says "Paused until Thu 19 Nov".
- **"Paused until" in red (K166).** A new colour role, `paused-ink` (#9f1d1d light, #f08a7e dark),
  at weight 600, on the grid's line only. John picked option A of the mockup
  `brand/design-system/mockups/261119-paused-until-red`.
- **The Changes log** showed every End programme row as "undefined" (from before this run). It
  now reads "Programme ended, from …" and "Programme re-opened, from …".

## 2. Process notes

- Five read-only and implementing agents ran in one worktree; W1, W2 and W3 in parallel, W4 and
  W5 after them. Footprints overlapped only in `test_mcp.py` and `docs/decisions.md`.
- The handover said the overview grid already read the sealed goal. It didn't: the grid used the
  same Sunday rule, which is why #86 needed a counting rule and not only a reader change
  (confirmed by reading `_cell_json`).
- The preview ran from a snapshot of the API on a copy of `api/.data`, so John's local data was not
  touched. Signing in as the demo account needed a password reset on the copy, which also revoked
  its MCP tokens.
- Every `ci.yml` step passed locally before the push (confirmed): web 1821 tests, API 2255 tests at
  99%, e2e 142, the design-system gate and pip-audit.

## 3. What is deliberately not done

- App buttons for restart and re-open: #87.
- A shared library of programmes users copy from, published only by John: #88, the next run.
- The week view's and item page's pause lines in red: #90, after a mockup each.
- "When resumed" week numbering, server against card: #89.
- A past week with a goal of 0 reading as Paused: #91 (suspected, predates this run).
- #85 and #76–#82 stay open, as John asked.
