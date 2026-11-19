# Paused until: red and heavier

**Question:** how the programme grid's "Paused until Wed 2 Dec" line stands out. The rest of the
cell and the grid stay as they are.

**Status:** decided

**Link:** https://claude.ai/artifact/3p1BiZn2qPDY6xVNxsxHfS

## Options

- **A.** Red, semibold: a new role `paused-ink`, #9f1d1d in light and #f08a7e in dark (error-ink's
  values), weight 600. 7.4:1 / 7.2:1 on the page, 6.7:1 / 6.0:1 on a past week's tile.
  (Recommended: John's ask as he put it.)
- **B.** As A, with the pause icon before the words, so it never reads as an error line.
- **C.** Ink, semibold. Heavier with no red; red stays for errors and too-difficult days.

The system keeps each red for one thing (`error-ink`, `pen-missed`, `caution-ink`), so A and B add
a role rather than reuse one.

## Decision

A, red and semibold, picked by John on 2026-11-19 ("A. Red, semibold (Recommended)"). Recorded
as K166: a new role `paused-ink`.

## Rounds

- **1, 2026-11-19:** the first options, from John's ask: "lets make the "Paused until Wed 2 Dec"
  text red and have heavier weight so it stands out more".
