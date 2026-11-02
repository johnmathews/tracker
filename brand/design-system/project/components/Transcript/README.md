The conversation on the Ask page, in rows like Settings: each question in the left column and its answer to the right, at a reading measure, with hairlines between the rows.

## Use

- **Layout A, John's pick (2026-11-01).** Each turn is a row: the question in a 240u left column, the answer to its right, 24u apart. It sits beside the SidePanel (S1), so the column is narrower than the week's 320u names. A 1px `line` rule opens the row, with 28u above and below.
- **The question:** `label` weight 600 at the page's label size (19u), line height 1.4, in `ink`. It wraps anywhere, so a long word never pushes the row wider.
- **What was read:** an optional line over the answer, in `caption` `ink-secondary` at 16u, 10u above the answer: "Read this week and the three before it, and your goals."
- **The answer:** the page's body size (19u, 18px at least), line height 1.55, `ink`. Paragraphs 0.6em apart, at most 68 characters a line; lists indent 1.2em at 64 characters; bold is 600. Links follow TextLink and open in a new tab. Inline code sits on a `tile`.
- **The markdown:** the answer is rendered by `answer()` in `src/lib/markdown.ts`. Raw HTML stays text, and `javascript:` links and images never render. A heading becomes a bold paragraph. Tables stay as their text, and a rule is left out. The system prompt asks for none of them.
- **Folded** (a phone, or an iPad held upright): the question sits over its answer in one column, 10px apart, 20px above and below.
- For the Ask page only. The question box, the quota and the notes under it belong to the page.

## States

| State | Look |
| --- | --- |
| Done | The whole answer. |
| Waiting | No answer text yet: AnswerProgress in the answer column, "Reading your weeks…". |
| Streaming | The answer so far, and a caret at the end of its last line: a block of `ink`, 0.5em by 1em, still. |
| Stopped | The answer as far as it got, no caret, then an InlineMessage (info) with the page's words. |
| Error | Whatever arrived, then an InlineMessage (error) saying what happened and what to do, and a secondary "Try again" button. |

## Accessibility

- The rows sit in one `role="log"` with `aria-live="polite"`, so a new turn is read out once it is there. A streaming answer is `aria-busy="true"`, so a screen reader waits for the whole answer instead of reading each piece as it lands.
- Each turn is an `<article>` named by its question. The caret is `aria-hidden`.
- An error's InlineMessage is `role="alert"`; "Try again" is a real button.
- `ink` and `ink-secondary` on `canvas`, and `ink` on `tile`, are measured by the gate.

## You provide

- `turns`: for each, the `question`, the `answer` in markdown so far, its `state` (`done`, `streaming`, `stopped`, `error`), and optionally `read` (the line over the answer) and `message` (the words for a stopped or failed turn). An `id` keeps a row stable as turns are added.
- Optionally `progressLabel`, AnswerProgress's words, and `label`, the log's name ("Conversation").
- A handler for `retry`, which carries the turn's index.
