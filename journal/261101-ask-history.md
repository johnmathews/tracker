# Ask's conversation history

> Purpose: how Ask came to keep each account's conversations on the server, and why the browser
> stopped sending the history. It is W8 of the /ask plan. The page that lists, opens and deletes
> them comes in W7.

## 1. Why

John's pick on the mockup (plan §1.1) reversed "chats stay in the tab": "save the conversations
as history. there should be a conversation history section." The history is stored per account,
synced across devices, counted in the 5 MiB quota, carried in the export, and deletable one by
one or all at once. Keeping it on the server also closes F12 outright. When the browser sent the
history, the server had to check every turn for forged tool calls and thinking blocks. Now the
server reads the turns from its own database, so there is nothing to forge.

## 2. What was built

- **Two tables** (migration 8, appended): `ask_conversations` (user, id, title, created, updated)
  and `ask_turns` (user, conversation, seq, question, answer, stop, asked). They hold text only.
  A CHECK keeps the answer empty for any stop but `end_turn` and `max_tokens`.
- **`POST /api/ask`** takes `{question, conversation?, today}`. A `history`, or any other key,
  gets 400. A missing or foreign `conversation` gets 404 before the claim, so it costs nothing.
  A new conversation gets a `secrets.token_urlsafe(12)` id. Its row is created in the claim's
  transaction, titled with the question cut to 80 code points. `start` carries
  `conversation`, and `done` carries `saved`.
- **What the model sees**: the saved turns as alternating text-only user and assistant messages,
  oldest first, then the question. The context opens the first user message, as before. A turn
  with an empty answer is left out whole. At most the newest 20 turns go, within 40,000
  characters, cut at the first that doesn't fit.
- **The save** (`ask.converse`, `ask.saver`) runs once the answer ends, before `done` goes out,
  on a worker thread with its own connection. After `end_turn` or `max_tokens` the turn keeps the
  streamed text. After `refused`, an `error` (busy included) or a client that leaves
  (`cancelled`), it keeps the question with an empty answer.
- **The quota** counts each title, question and answer by its UTF-8 bytes, plus 64 per
  conversation and per turn, as a tick row counts 64. A turn that would go over isn't saved, and
  `done.saved` is false. If that was a new conversation's first turn, the conversation goes too,
  so a full account keeps nothing.
- **Four endpoints**: list (`{conversations: [{id, title, updatedAt, turns}]}`, newest first),
  read one, delete one, delete all. They need a session, and the deletes pass the write guard.
- **Export and import.** The API's export carries `conversations`. Import adds those whose id the
  account lacks and never changes one it has. `normalise_conversations` / `normaliseConversations`
  and `merge_conversations` / `mergeConversations` share fixtures: `parse/conversations*.json`
  and `merge-conversations.json`. `EXPORT_VERSION` stays 4.

## 3. Decisions

- **The key is (account, id), not the id alone.** The plan had `id TEXT PRIMARY KEY`. With a
  global key, Bob importing Alice's file would hit her row: the import would either fail with an
  IntegrityError or skip the conversation, so the plan's rule ("ids the account doesn't have")
  couldn't hold. `ask_turns` carries `user_id` for the composite foreign key.
- **The list is wrapped as `{conversations: [...]}`.** The plan wrote a bare array. The web
  client's `request()` treats a body that isn't an object as an error (`src/lib/api.ts`,
  `readJson`), so W7 couldn't read a bare array.
- **Times are Unix seconds**, as everywhere in the database, in the endpoints and in the file. A
  whole number from 0 to 2^53 − 1 validates the same in both languages; ISO strings would need
  two date parsers to agree.
- **Keys are camelCase where they leave the API** (`createdAt`, `updatedAt`, `askedAt`), as
  in the rest of the API and the export file (`exportedAt`, `dailyPick`). The first cut used the
  plan's snake_case; the coordinator asked for camelCase before anything shipped. The columns
  stay snake_case, and so does `insights.py`.
- **20 saved turns**, each a question and its answer. W4's cap was 20 messages, but the lead's
  note counts turns from `ask_turns`. The 40,000-character cap binds first in practice.
- **`saved` is false for a conversation deleted while it answered.** The lead's note says false
  only for the quota. The turn isn't kept either way, though, and `true` would be untrue. Flipping
  it is one line in `ask.save_turn`.
- **The history routes work with Ask off.** Deleting what was kept shouldn't depend on the key.
- **`conversations` is in the parsed data only when the file has a list.** That keeps every
  earlier parse fixture, `legacy.ts` and `sync.spec.ts`'s typed `ExportData` unchanged, and it
  reads a file without the key as one from before it.
- **The TypeScript split.** `storage.ts` has the types (`AskStop`, `AskTurn`, `Conversation`)
  and now exports `cutText`. `transfer.ts` parses, normalises and merges. `buildExport` is
  unchanged, because the browser holds no conversations.
- **Answers are trimmed and cut on save**, as the file's normaliser would trim and cut them, so
  an export imports back unchanged.

## 4. What was surprising

- **A client gone before the first frame never ran the answer at all.** `frames` had not
  started, so nothing saved the question: a probe left the conversation with no turn. The
  response now calls the save again on close (`EventStream(on_close=...)`). The save runs at most
  once, so after a normal answer the second call does nothing.
- **The shield on the cancel path isn't what makes it work.** With the shield removed, both
  cancel tests still passed. A native `task.cancel()` is spent once delivered, and anyio's
  `to_thread.run_sync` shields itself. Removing the save made both tests fail. The shield stays
  against a second cancellation, such as a shutdown.
- **The limits fixture is about 250 KB**, most of it the 64,000-character answer, written twice.

## 5. The test-first record

The tests went in first and were watched fail:

- `test_parity.py` could not import `merge_conversations`.
- A `history` body and an unknown key streamed as HTTP 200 (`JSONDecodeError` on the expected
  400).
- `start` had no `conversation` (`KeyError`), and `done` had no `saved`.
- The tables didn't exist.
- Vitest failed the 3 new parse fixtures and the 5 merge cases.

Two cases passed before any code, as they should: the tool_use and thinking forgeries, which W4
already refused.

After the code, a mutation check: deleting the cancel-path save turned both cancel tests red.
Then the before-the-first-frame probe found the gap above. Its test failed on the missing
`on_close` and passed once the gap was closed.

## 6. Left for later

- **W7, browser import.** `sync.importFile` builds the POST body from `exercise`, `diet` and
  `settings` only (`src/stores/sync.ts`), so a file's conversations never reach the server from
  Settings → Import. `transfer.ts` carries them in `ExportData`. One spread line in `sync.ts`
  sends them.
- **W7, Settings → Export.** The browser's export comes from `buildExport`, which has no
  conversations, so a downloaded file lacks the history. Either fetch `GET /api/export`, or pass
  the conversations in.
- **W7, `api.ts`.** `request()` accepts only GET, POST and PUT, and sets `Content-Type` only with
  a body. A DELETE must send `Content-Type: application/json`.
- **The import limits are below what an account can hold.** Storage has no cap on conversations
  or turns, and a file reads only 500 of 200 turns each. `POST /import` takes 1 MiB, against a
  5 MiB quota. An account with a long history couldn't round-trip through one file. That needs
  John's call.
