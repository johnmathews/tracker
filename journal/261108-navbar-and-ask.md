# A bar led by the week, and a smaller Ask

Once a long press opened Edit plan (K80), John asked on 2026-11-08 for the bar and Ask to follow:
"edit mode and havng the navbar visible are now the same thing", with four screenshots. The
mockup `brand/design-system/mockups/261108-navbar-and-ask` (one round) settled K81 to K84.

## What John picked

- **K81, A:** no wordmark; the week first, in the serif at the section titles' size.
- **K82, K2:** no Edit plan button. Edit plan ends its actions with a filled "Done". On the week
  a hidden "Edit plan" is the second Tab stop, so the keyboard can still reach Edit plan. He
  chose K2 over the recommended K1, so there is a visible way out for everyone.
- **K83, S2:** Ask at about 70%, as at his zoom. Controls keep 44px. The intro is 72 characters
  of its own size. The "Ask" beside the box goes.
- **K84, D1:** a View switch, Document (the rows, the default) or Conversation (the 1 November
  mockup's B).

## How

- `AppNavbar.vue` is one flex row now. The week label is `title-1` at `--bar-week`, which became
  `--fs-title` (26n folded). `--bar-wordmark` went.
- One test id, `edit-plan-button`, covers both mode buttons: the hidden button off Edit plan,
  and Done in it. Tests that toggle Edit plan kept working.
- BarAction gained `filled`, a cva variant. The `aria-pressed` toggle look stays for any future
  toggle.
- Ask shrinks by overriding the `--set-*` sizes on `[data-slot="ask-page"]`. Settings and the item
  page keep theirs. The override also covers a new `--set-caption` (it replaces four hard-coded
  `max(16px, 16u)`), `--fs-title`, `--side-panel-w` (SidePanel's width, defaulting to 300u) and
  `--ask-q-col` (the Transcript's question column, defaulting to 240u).
- Transcript takes `view`. AskPage keeps it in `localStorage` (`tracker-ask-view-v1`), falling
  back to Document on anything else.

## Checks

- Each new test failed before its code: the bar's two tests against the old navbar, the two Ask
  tests, and the Transcript view tests against the old component.
- The whole CI workflow ran locally before the single push (John: "Run CI locally. Minimise gh
  actions usage").
