The small form for writing or changing the note on one day of one exercise, set in the serif italic that marks the person's own words.

**Design only.** A note on one day has no storage yet: day notes are a separate feature unit built after the design system (K6). This card gives that feature its look and behaviour; nothing in the app opens it today. An item's own notes are another thing: one copy per exercise or food for every week, stored with its details and edited on its page (ItemPage card, K64, K104), whose notes field takes this card's skin.

## Use

- A Panel (`panel`, 1px `line` border, `radius-lg`, `shadow-overlay`), 360px wide, `space-4` padding. It opens as a Popover beside the day on desktop and as a Dialog on a phone.
- A context line first, in `caption` `ink-secondary`: the row name in `ink` at 600, then the full date ("**Squats** · Thursday 22 October"). The editor has no other title.
- The field: the visible label "Note" in `label`, then a textarea in the `note` style (Source Serif 4 italic, 18/26) on `tile`, 1px `control-border`, `radius-sm`, at least 120px tall, resizable vertically.
- Buttons at the end: secondary "Cancel", primary "Save" (`ink` fill, K8).
- No placeholder. The editor only ever opens because the person chose to write a note, so it has nothing to ask. Never "How did it go?", "Add a note…" in an empty row, a reminder or a count of days without notes.
- Saving an empty note removes the note; there is no separate delete and no confirmation.
- Notes are the person's words. The app shows them back only where they were written (the day's cell, SearchResult) and never quotes them as advice.

## States

| State | Look |
| --- | --- |
| Existing note | textarea filled, cursor at the end |
| New note | textarea empty, no placeholder, focused on open |
| Focus | solid 2px `focus` outline at 2px offset around the textarea or button |
| Saving fails | an InlineMessage (error) above the buttons; the text stays in the field |

## Accessibility

- A `<form>` labelled by its context line (`aria-labelledby`), so a screen reader announces "Squats · Thursday 22 October, form".
- The textarea has a real `<label>` "Note".
- Focus moves to the textarea on open and returns to the control that opened it on close. Escape cancels. Enter adds a line; Ctrl+Enter or Cmd+Enter saves.
- `ink` on `tile` and `control-border` on `tile` are measured by the gate.

## You provide

The row name, the full date, the existing note (or nothing), and the save and cancel handlers.
