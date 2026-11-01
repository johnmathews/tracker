# My goals in settings

> Purpose: how the free-text "My goals" became a synced setting without an older tab being able to
> erase it. It is W3 of the /ask plan. The Settings row that edits it comes in W7.

## 1. Why

John chose "app goals plus a free-text note" as what Ask judges him against. The weekly goals and
the two daily targets already exist. The note is new: a paragraph in his own words, kept with his
account. The evaluation found that the settings path was built for three numbers and loses
anything else (F1). Every normaliser dropped an unknown key, `put_settings` wrote only what it was
sent, and the sync diff compared only the numbers. One tab still open on the code from before the
note would send settings without it, and the server would store `''`.

## 2. What was built

- **A column.** Migration 6 (or 7, after a rebase): `settings.goals TEXT NOT NULL DEFAULT ''`.
  Saved rows read as having no goals. `test_db.py` finds the step by its text, so a renumbering
  needs no test edit. The old `== 5` assertion beside `SCHEMA_VERSION` is gone for the same reason.
- **One normaliser in two languages.** `normalise_goals` and `normaliseGoals` trim spaces, tabs
  and line breaks at the ends, cut at 1,000 code points, and give `''` for blank text or a
  non-string. Notes share the helper now (`_cut_text`, `cutText`). Three parse fixtures
  (`fixtures/transfer/parse/goals*.json`) run in both suites.
- **The server guard.** `put_settings` keeps the saved goals when a write leaves them out, or
  sends something that isn't a string, as it already did for `foodPick` (K57).
- **The client guard.** The planner store has `goals`, `setGoals` and `goalsKnown`. Goals become
  known when they come from the server, from a cache that carries them, or from the person.
  `portableSettings()` leaves unknown goals out, so they are never sent or cached. `normaliseState`
  keeps `goals` only when it is a string, so adopting an old tab's cache keeps this tab's goals.
- **The diff** compares the goals, so an edit is one settings write like any other.
- **Import.** `merge_settings` and `mergeSettings` let a file's goals fill empty ones and never
  replace saved ones. `import_data` now goes through `merge_settings`, so the API and the parity
  fixtures use one rule. The result's `settings` is true when the file changed anything, goals
  alone included.
- **`insights.goals(...)["note"]`** returns the saved text.

## 3. Decisions

- **No export version bump.** `EXPORT_VERSION` stays 4, as for `foodPick`. A reader from before
  the field drops it; a file without it reads as no goals.
- **The merge rule is the stated default.** John's answer on import (F17) is still pending on the
  W2 mockup. The default fills only empty goals. If he picks otherwise, `merge-settings.json` and
  the two `merge_settings` functions change together.
- **No debounce in the store (F18).** `setGoals` ignores the same text again, and the W7 row will
  commit on blur or after a pause. One change still makes one PUT.
- **Settings that adopt receives as null keep the goals.** Only `clear()` on sign-out or a user
  switch resets them. A null from an older tab's cache is "not said", like a missing key.
- **The test-first record.** Each guard was first written naively and the tests watched fail
  before the guard went in. The server test failed with `{'goals': ''} != {'goals': 'Lose 3 kg.'}`
  after an old-tab PUT. The client tests failed with `'' ≠ 'Lose 3 kg.'` after adopting an old
  cache, and with a cache that claimed `goals: ''` the tab had never read.

## 4. Left for later units

- `useImportSummary` still counts settings only when none are saved. A file whose only addition is
  goals for an account with empty ones therefore stops at "Nothing new" in Settings → Import
  (`SettingsPage.vue`, the `addsAnything` check) and never reaches the server, and the summary
  sentence never mentions goals. The API and both merge functions apply the rule; the browser's
  gate in front of them doesn't yet. `src/composables/importSummary.ts` is outside W3's files, and
  its sentence is copy, so it waits for W7 and John's import answer.
- A settings PUT's reply carries the saved goals, but the client doesn't adopt them. The next read
  does, within a minute.
