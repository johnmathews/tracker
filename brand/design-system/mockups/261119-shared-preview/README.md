# Shared library: preview before copying

**Question:** what Preview opens on a shared row, so that anyone can look at a shared programme's
plan before copying it (#88, asked by John after trying the build). The rest of the Library tab
stays as it is: the section From the shared library (K171), and Copy to library's question and its
Added to library state (K172).

**Status:** decided

**Link:** https://claude.ai/artifact/NxmPs36jF6CyDV49MkWZzQ

## Options

No option adds a colour or a `--candidate-*` value. Each uses the system's tokens and existing
cards: ProgrammesPage, Button, Dialog, TextLink and ProgrammeGrid. Each shared row gains
**Preview** (secondary, Lucide `eye`) before Copy to library; folded, the two sit side by side. The
grid is the server's (P4), at the programme's own values, with weeks by number.

- **A.** The plan, opened in place, framed in 2px `ink` as Preview and start is (K147): a line,
  the ProgrammeGrid, then **Close** and **Copy to library** (primary). One row opens at a time.
  (Recommended: the look the Library already uses, so a programme reads the same before and after
  the copy.)
- **B.** As A, and under the grid each activity's notes and link, as Publish's preview lists them.
  The frame is about twice as tall on a phone.
- **C.** A Dialog titled with the programme's name: the facts, the description, the grid, and
  each activity's notes and link, with **Close** and **Copy to library** at its foot.

## Decision

C, a Dialog: "C. A Dialog", John, 2026-11-19. It became K173 in `docs/decisions.md`.

## Rounds

- **1, 2026-11-19:** the first options.
