A small panel attached to the control that opened it. The app has none at the moment: Settings, which was one, became the SettingsPage (2026-10-25) to have room to grow. The rules below are what a popover must follow when one comes back; the settings contents they describe now live on that page. The account and Sign out will not come back to a popover: they are the account Menu under the Header's "Profile" action now (K106), a list of actions rather than a panel of settings.

## Use

- **Anchor:** the settings IconButton (Lucide `settings`, 20px, 44px target, label "Settings"). While open, the button has a `tile` fill and `aria-expanded="true"`.
- **Panel:** `panel` fill, 1px `line` border, `radius-lg`, `shadow-overlay` (none in dark), `space-4` padding, 296px wide. It opens `space-2` below the button with their right edges aligned, and stays inside the screen with a `space-4` margin on a phone.
- **Contents, in order** (the Settings panel as it was; the SettingsPage card now owns them):
  1. The title "Settings" in `title-2`.
  2. **Theme:** a SegmentedControl, System | Light | Dark, drawn exactly as its card (44px, `label` type on every segment).
  3. **Exercises a day:** a Stepper, 1 to 8, the daily pick, drawn as its card (one outline, no separators), with its label beside it.
  4. **Your data**, after a `line` rule: secondary buttons "Export" (Lucide `download`) and "Import…" (Lucide `upload`). Import's summary and its own Cancel then Import (secondary first, primary last) appear here, inline, beneath.
  5. **Account** (now the Menu, K106), after a `line` rule: "Signed in as alex" in `caption` and a secondary "Sign out" (Lucide `log-out`). Sign out with unsynced changes asks first with a ConfirmDialog.
- Every button in the panel is md (44px), on desktop as on a phone: the popover is used on phones.
- Group labels in `label`, sentence case: "Theme", not "APPEARANCE".
- Settings take effect at once; there is no Save.
- Outcomes (import done, import failed, sign-out failed) appear inside the popover as an InlineMessage under the group that caused them.
- Doesn't print.

## States

| State | Look |
| --- | --- |
| Closed | the button alone |
| Open | button on `tile`, panel shown; appears without motion beyond a 120ms fade |
| Import pending | the import summary and Cancel · Import under the data buttons |
| Result | an InlineMessage (success, or error with what to do) |

## Accessibility

- Built on Reka UI's Popover (K1): the button has `aria-expanded` and `aria-controls`; the panel is `role="dialog"` labelled by its title.
- On open, focus moves into the panel; Tab moves through it; Escape closes it and returns focus to the button. **Focus leaving the panel closes it** (the old popover stayed open while focus moved to the grid underneath, F14), as does a click outside.
- Theme is a SegmentedControl: a `role="group"` labelled "Theme" of `aria-pressed` buttons, single choice (pressing the chosen segment keeps it chosen); Tab enters the group and arrow keys move between segments (Reka's roving focus).
- The Stepper's buttons are named "Fewer exercises a day" and "More exercises a day". At a limit the button gets `aria-disabled="true"` (so focus stays put) and is drawn as the Stepper card draws it: its icon at 40% opacity, no hover fill. The value is an `<output aria-live="polite">`.

## You provide

The current theme and daily pick with their change handlers; the export and import handlers; the signed-in name and the sign-out handler.
