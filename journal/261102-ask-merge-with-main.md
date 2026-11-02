# Ask meets main: item pages, tracker types and MCP landed first

2026-11-02. Wrap-up of the Ask run (`/done`). Before opening the PR, `origin/main` had moved on
by three PRs: the MCP endpoint and API tokens (#54), tracker types with item pages and item
details (#55), and a design-system republish (#56). This branch touched 50 of the same files,
so main was merged in (commit `01682cd`) rather than rebased. The PR is squash-merged, so the
merge commit never reaches main.

## What the merge decided

- **Migrations.** Main took 6 (API tokens), 7 (item details) and 8 (item-page sections). This
  branch's three move to the end: 9 My goals, 10 `ask_log`, 11 Ask's history, as the
  first-to-merge rule agreed with the peer sessions said. `test_db.py` finds each step by its
  text, so only the numbering test changed. A copy of John's local data (version 5) was
  migrated to 11 on the preview: every table is there and the demo account answered a question.
- **Decision ids.** Main took K64–K66 for the item page. Ask's K64–K69 are now K67–K72,
  changed only on the lines this branch wrote, so main's K64–K66 references stay.
  `docs/decisions.md` §4.14 is the item page and §4.15 Ask.
- **api.md sections.** Main's MCP section is §3.1, so Ask's moved after it as §3.2, and every
  reference this branch made to §3.1 now says §3.2.
- **Export.** Main bumped the file to version 5 for item details. Goals and conversations still
  ride in it without a version of their own, as agreed with the tracker-types session.
- **Ask's date.** Ask now checks the browser's `today` against `config.today()`, the date in
  `TIMEZONE`, instead of the UTC date. That was agreed with the MCP session for when its
  `config.today()` landed first, and it did. A new test, at 22:30 UTC on 23 October (the 24th in
  Amsterdam), was observed failing against the old UTC rule and passing against the new one.
- **Settings writes.** Main's rule sends `itemSections` on every settings write, `{}` for the
  default; this branch's rule sends `goals` only once the tab knows them (F1). The merged
  `sendSettings` does both. The server keeps saved `goals` and `itemSections` when a write
  leaves them out.
- **The import summary** names item details, the daily targets, goals and Ask conversations in
  one list ("…plus the notes and details of two items, the exercises and foods a day and your
  goals.").
- **`merge_settings`** reads the file's goals with `.get`: a file read without goals has none to
  give, as the web app already treated it. Main's merge-settings fixture had none.

## Found on the way

- **A date-dependent test on main.** `App.spec.ts` "saves the note for every week…" named next
  week as 26 October without pinning the clock. On Monday 2 November it failed, on main as much
  as here. This branch first pinned its group's clock; then main fixed it in #57 by reading next
  week's key from the store, and the second merge (of #57) took main's fix and dropped the pin.
- `docs/development.md` now lists the Ask specs (a W7 finding left for the wrap-up).

## Checks run after the merge (confirmed)

- API: ruff, ruff format, mypy, `coverage run -m pytest` and `coverage report` (99%, over the
  98% floor), all exit 0.
- Web: lint, format check, type check, `vitest --coverage` (1,151 tests, thresholds met),
  build, the design-system gate (`--complete`, 38 components), the tokens check, and the
  Playwright suite (72 tests).

## What is deliberately not done

- No rebase. The branch's commits stay as written, and the merge commit carries the
  resolution; the squash merge flattens both.
- The peer sessions' own worktrees and branches were not touched. Both have merged; the PR
  number goes to them when it opens.

## Shipped (2026-11-02)

- PR #58 was squash-merged as `bc31eb8` at 07:57 CET. CI on `main` passed (check, e2e, api),
  and `docker.yml` then published `ghcr.io/johnmathews/tracker` and `tracker-api` from that
  commit. What's Up Docker on the home server pulls `latest` from there.
- Ask stays hidden in production until `fitness-api` gets `ANTHROPIC_API_KEY` from the vault
  (`docs/deployment.md`). Until then, nothing else changes for anyone.
- The design-system artifact is at version 55, with the five Ask cards and voice.md's Ask
  section. Its index's `lastChange` is committed in #59.
