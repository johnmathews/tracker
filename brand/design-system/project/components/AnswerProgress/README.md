The line that shows an answer is on its way: a pen of three short strokes, then the words "Reading your weeks…".

## Use

- Three strokes, each 10px by 3px with a 2px radius, 4px apart, in `ink`; then the words, 10u after them, in `ink-secondary` at the page's label size (17u, 16px at least).
- The strokes dim in turn, a fifth of a second apart, over 1.2 seconds, like a pen writing. Under `prefers-reduced-motion` they stand still, at 35% `ink`.
- The words never fade: only the strokes move.
- It sits in the Transcript's answer column until the first words of the answer arrive, then gives way to them. Not a page loader and not a spinner: for loading data, use the Banner.
- The words say what is happening, as a fact: "Reading your weeks…". No "Thinking…" and no jokes.

## States

| State | Look |
| --- | --- |
| Moving | The strokes dim in turn. |
| Reduced motion | The same three strokes, still. |

## Accessibility

- `role="status"`, so a screen reader reads the words once, without interrupting. The strokes are `aria-hidden`.
- The strokes carry no meaning on their own, so their 35% doesn't need a contrast ratio. `ink-secondary` on `canvas` is measured by the gate.

## You provide

- The words, if not "Reading your weeks…".
