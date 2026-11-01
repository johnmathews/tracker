# The Ask page

> Purpose: how the Ask page, its bar action and the Settings "Your goals" row were built (W7 of
> the /ask plan), on the API from W4 and W8 and the components from W6, and what was decided on
> the way. The decisions are K64–K69 in `docs/decisions.md`.

## 1. What John picked

On the mockup `brand/design-system/mockups/261101-ask-page` (three rounds, plan §1.1):

- **Layout A**, rows like Settings (K64), with Ask before Settings in the bar.
- **Voice V2, extended** (K65): "V2 - plain verdict, the app may qote a note back as advice. and
  also may include streaks scores or rankings." It is a carve-out for answers only, written into
  `voice.md` ("Ask"); `PLAIN_VERDICTS` is now on in `ask.py`, and `VERDICT_RULE` allows streaks,
  scores, rankings and quoting goals and notes back. `checks.json` still bans "streak" in previews.
- **History on the server** (K66) as a **side panel, S1** (K67).
- **The chip always shown** (K68), and **import fills only empty goals** (K69).

## 2. What was built

- **`stream()` in `src/lib/api.ts`.** A fetch POST read with `getReader()`, split into
  server-sent events at blank lines wherever the chunks break, `:` comments skipped. It shares
  `errorFor` with `request()`, so a 503 with `ask-off` is a refusal and a bare 503 is offline. It
  ends well only at `done` or `error`. No such event, a dropped connection, or 30 s with no frame
  is `cut` (W5's C3: a proxy cut arrives as 200). Stop is `stopped`. `request()` gained DELETE: no
  body, but still the JSON content type the API wants on every write.
- **The session's `ask` flag** is three-state and loads after every sign-in, a remembered user's
  included (F9), and on `online`.
- **`src/stores/ask.ts`**: the turns, the status, the questions left, the history list, the box's
  draft. It awaits `sync.flush()` before asking and keeps the count of changes still waiting (F11).
  It sends `today` as the browser's date (F15), and draws text once per animation frame. It
  clears on sign-out or a user change. `src/lib/ask.ts` holds the page's words.
- **`AskPage.vue`** on SidePanel, HistoryList, Transcript, AnswerProgress and QuotaChip, every
  state from the mockup: empty, no goals, answering (Send becomes Stop), cap reached (with the
  time when the 429 gave one), error with Try again, offline, unsynced, and "Your account is full,
  so this answer wasn't saved." Deleting asks in a ConfirmDialog; Cancel returns to the bin.
- **`App.vue`**: `#/ask` shows only while the flag is `true`; it waits on the week while the flag
  is unknown and drops the address once it is `false`. Leaving returns focus to the bar's Ask
  button, and signing out on the page lands on sign-in with the transcript cleared.
- **Settings "Your goals"**: a TextArea saved on blur or after a 600 ms pause (F18), never over a
  draft mid-pause, and closed to typing until the goals are known.
- **Export** reads `GET /api/export` for the server's conversations and adds them to the
  device's file. **Import** posts a file's conversations, and the summary counts them and names
  goals that only fill empty ones.
- **Styles**: the Ask page takes Settings' `--set-*` sizes, and AnswerProgress has its own
  `pen-write` keyframe (35% to full ink and back) instead of Tailwind's pulse.

## 3. Things found on the way

- **A new account could never type its goals.** With `settings: null` from the server,
  `planner.goalsKnown` stays false (`planner.adopt` sets it only from settings that carry goals).
  Gating the row on `goalsKnown` alone would have closed it for every new account. So the row,
  and the page's "no goals yet", also accept a server read that found no settings at all
  (`sync.fresh && savedSettings() === null`).
- **`GET /api/ask` has no reset time.** A page that loads with none left can't say when asking
  opens again, so it says "You can ask again within 24 hours." Once a question gets 429, the time
  from `retryAfter` replaces it. Adding `retryAfter` to `GET /api/ask` would make it exact.
- **The mockup's Settings frame still had a Planner row** (copied before K59 removed it), so
  "between Planner and Your data" became between Appearance and Your data.
- **The import body limit stays 1 MiB.** An export with many conversations can pass it, and then
  the API answers 413 `too-large`. The app has no words of its own for that code: Settings says
  "The server refused the import, so nothing changed." That is accepted for now; raising the
  limit for `/import`, or a sentence that names the size, waits on John.

## 4. Checks

- Vitest: the stream reader (frames split across chunks, comments, no `done`, idle timeout,
  abort), the store, the page's states, routing, the bar action, the flag for a remembered user,
  the goals row (one PUT per pause) and export and import with conversations, written first and
  seen failing.
- Playwright: axe on the Ask page in both themes at desktop and 375px, with the delete question
  and the drawer open, and no sideways scroll at 375px.
- pytest: the prompt carries John's rule, and the strict rules return with the switch off.
