# Edit plan frame

**Question:** which frame round the window says Edit plan is on (K112)? The page under it stays as
it is.

**Status:** decided (B)

**Link:** https://claude.ai/artifact/QUTmfFg893EBBbDqWVVtFk

## Options

- **A.** A new colour role, `edit`: #2563c9 in light, #6b9ef2 in dark, 4px. (Recommended: a blue
  of its own, so the frame and the focus ring never mean the same thing.)
- **B.** The same `edit` blue, 8px.
- **C.** The focus ring's blue (#2b4c7e in light, #9db8e8 in dark), 4px, with no new role.

## Decision

**B**, picked by John on 2026-11-11 ("B: new blue, 8px"), recorded as K112 in
[decisions.md](../../../../docs/decisions.md). The `edit` role joins `tokens.json`: #2563c9 in
light, #6b9ef2 in dark, drawn 8px wide round the window while Edit plan is on.

## Rounds

- **1, 2026-11-11:** the first options, on screenshots of the real app in Edit plan (desktop
  1280 × 800 and phone 390 × 844, light and dark).
