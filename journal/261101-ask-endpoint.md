# The Ask endpoint

> Purpose: how the API came to answer questions with Claude, under daily caps and with no content
> in its logs. It is W4 of the /ask plan. The page that calls it comes in W7, and W5 checks the
> stream through nginx and a dropped client.

## 1. Why

John wants an Ask page where he can ask whether he is doing too much or too little for his goals.
He chose Claude, called from the API with a key in the server's environment, every account with a
daily cap, and chats kept in the browser (request.md). The evaluation set the constraints: a hard
bound on spend (F4), text-only history (F12), bounded user text (F13), the browser's own date
(F15), a stream nginx won't buffer (F2), and a written rule against logging content (F20).

## 2. What was built

- **`POST /api/ask`** checks the question, claims it against the caps, then streams `start`,
  `tool`, `text`, and `done` or `error` as server-sent events, with a keep-alive comment after 15
  seconds of silence. `GET /api/ask` gives `{remaining, limit}`, and `GET /api/auth/options` says
  whether Ask is on.
- **The caps.** `ask_log` (migration 7, or 8 after a rebase) holds who asked and when. A claim
  runs under `BEGIN IMMEDIATE`, per account (`ASK_PER_DAY`, 30) and for everyone
  (`ASK_PER_DAY_TOTAL`, 300), over a rolling day. A failed answer still counts.
- **The loop** in `ask.py` calls `client.messages.stream` up to six times, running the tools
  between rounds. The sixth request may not call a tool, so it can only answer.
- **The tools** wrap the five insights readers. Each is a closure over the session's user and the
  question's `today`, reads on a worker thread with its own connection, and returns at most 20 KB.
- **The prompt** is one frozen constant with the cache breakpoint on it. Today, this week and the
  My goals note open the first user turn.
- **Logging.** The API's info lines now reach stderr: uvicorn configures only its own loggers, so
  before this the backup's info line never showed either. Ask logs request ids, stop reasons,
  token counts and rounds. `docs/api.md` §6 writes down the rule that no content is logged.

## 3. Decisions

- **A written-out loop, not the beta tool runner.** The runner passes a call's input through
  `pydantic.validate_call`, so an input with a key the schema lacks, such as a forged `user_id`,
  fails as a `ValueError` and is logged with `log.exception`. The plan wants that key ignored. The
  written-out loop also has each round's request id, usage and stop reason at hand. It is about
  120 lines with its logging and error mapping; the loop alone is about 50.
- **`tool_choice: none` on the last round.** An answer that ends on an unanswered tool call is
  worse than one written from what was read. A last round that still asks for a tool ends as
  `max_tokens`, "cut short".
- **No server-side fallback.** On Claude Sonnet 5.5 it retries only `cyber` and `frontier_llm`
  declines. Questions about a week of push-ups meet neither.
- **No eager input streaming.** The tool inputs are a few tokens, so streaming them early gains
  nothing, and it would give up the server's strict validation.
- **Automatic caching as well as the system breakpoint.** Each round of one question then reads
  the round before it.
- **`remaining` is the smaller of the account's and everyone's.** The chip then never promises a
  question the total cap would refuse.
- **The verdict rule is off.** John's ruling on the voice (F7) is pending on the W2 mockup.
  `VERDICT_RULE` and `PLAIN_VERDICTS` in `ask.py` turn it on in one line, and the tests cover both.
- **A response class that listens for a disconnect.** Under ASGI 2.4, Starlette's
  `StreamingResponse` notices a gone client only when a write fails, and leaves the unfinished
  generator to the garbage collector. `EventStream` listens for the disconnect and closes the
  frames, which cancels the request to Anthropic. W5 proves it through the whole app.

## 4. What was surprising

- `anthropic` 2.3 sends the key as `Authorization: Bearer`, not `x-api-key`, with API version
  `2026-10-21`. The test transport asserts the bearer header.
- At `ANTHROPIC_LOG=debug` the SDK logs each request's body, the question included. The docs say
  to leave it unset.
- A stream that fails after it began is an HTTP 200 whose `error` event names the type, so the SDK
  raises an `APIStatusError` with status 200. `busy` is decided by the error type as well as the
  status.

## 5. The test-first record

The tests were written first and watched fail: `test_ask.py` could not import `tracker_api.ask`,
and the config, migration and options tests failed on the missing fields, table and key. The
first green run then failed every streamed test with `error: busy`: the transport asserted an
`x-api-key` header the SDK no longer sends. A history test failed on its own arithmetic (40,014
characters, over the cap), which the cap was right to refuse.

## 6. Left for later units

- W5: the stream through the production nginx with a 70-second gap, and a client dropping
  mid-answer through the whole app.
- W7: the page, its `stream()` reader, discarding the partial text on `refused`, and the chip from
  `GET /api/ask`.
- John: the key in the vault, the compose template, and the spend limit in the Anthropic Console
  (deployment.md §4).
