A small quiet tag under an exercise name that says how much: sets × reps or time, each side, or the weight. After a programme's name it can say one state instead: "Shared".

## Use

- `label` type (16/22, 600) in `ink-secondary` on a `tile` fill, `radius-sm`, `space-2` side padding, no border. Chips sit `space-2` apart and wrap; they never truncate. In a WeekGrid row a chip is one size up, at 18, and grows with the screen (K46).
- One chip for the count, one for the weight. Write them from the exercise's fields:

  | Fields | Chip |
  | --- | --- |
  | sets and reps | "3 × 12" |
  | sets and reps, each side | "3 × 8 each side" |
  | reps only | "10 reps a set" |
  | reps only, each side | "8 each side" |
  | sets only | "3 sets" |
  | sets and time | "3 × 45 s", "3 × 2 min" |
  | time only, each side | "1 min 30 s each side" |
  | weight | "16 kg" (a second chip) |
  | nothing | no chip (not a dash) |

- Use the multiplication sign "×" with spaces, never "x" or "*". Figures, not words: chips are data.
- In WeekGrid the chips share the name's line, wrapping beneath it when they don't fit; the note takes the line below (K43).
- **A state (K171):** one chip, "Shared", after a library programme's name on the admin's Programmes page, on the name's line, `space-3` after it, wrapping under it on a narrow screen. It says the programme is in the shared library. It is the only state a chip names; a state that needs an action, or a colour, is not a chip. Nobody but the admin sees it.
- Never the `pen` colour, never a colour per exercise type, never clickable. A chip is information, not a filter or a button.
- **Print:** the fill drops and a 1px rule outlines the chip, so it survives black-and-white printing.

## States

One state. Chips don't hover, select or dismiss. "Shared" is words in a chip, not a state of the chip: it looks like every other.

## Accessibility

- Plain text in a `<span>`; a screen reader reads "Squats, 3 × 15, 16 kg" in order, and "Strength 5×5, Shared" after the name's heading. Read "×" as "by" only if testing shows a screen reader skipping it; VoiceOver and NVDA read "times".
- `ink-secondary` on `tile` meets 4.5:1 in both themes (measured by the gate).

## You provide

The text, already formatted as in the table above, or "Shared".
