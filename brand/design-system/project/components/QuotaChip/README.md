A Chip under the question box that says how many questions are left today, in words from three down.

## Use

- A Chip: `label` type (16/22, 600) on a `tile` fill, `radius-sm`, `space-2` side padding, 2px above and below, never wrapping and never clickable.
- Always shown on the Ask page (John's pick, 2026-11-01), at the foot of the question box, beside the line under it.
- The words, from what is left:

  | Left | Chip |
  | --- | --- |
  | 27 | "27 questions left today" |
  | 4 | "4 questions left today" |
  | 3 | "Three questions left today" |
  | 2 | "Two questions left today" |
  | 1 | "One question left today" |
  | 0 | "No questions left today" |

- Three and under are words, as small numbers in a sentence are (Voice). Above three the figure stays, since the count is data that changes after every answer.
- At none left the words are `ink`, not `ink-secondary`, so the one count that stops you reads first. Never `error-ink` or `caution-ink`: reaching the day's limit is not a fault. The page says when asking opens again.

## States

| State | Look |
| --- | --- |
| Some left | The count in `ink-secondary`. |
| None left | "No questions left today" in `ink`. |

## Accessibility

- Plain text in a `<span>`, read in order after the question box. It isn't a live region: the answer and its progress line are announced, and the count can be read when the person reaches it.
- `ink-secondary` and `ink` on `tile` meet 4.5:1 in both themes (measured by the gate).

## You provide

- `remaining` and `limit`: the questions left today and the day's allowance, from the server. A count outside 0 to `limit` is held to it.
