A value chosen at start in the programme builder, such as a squat's starting weight: closed, a row with its default and the fields that use it; open in place, its label, unit, default and range.

## Use

- **Where:** the Values chosen at start section of the ProgrammeBuilder card (the document's `params`, programmes.md §2.2), one per value, then **Add a value** (secondary, Lucide `plus`), which adds one, open. A ValueField's Starts at or Amount then picks it from a Menu.
- **Closed:** a row on 1px `line` rules: the label in weight 600 at 19u ("Squat start"), the default in `body` ("40 kg by default"), and the fields that use it in `caption` `ink-secondary` ("Used by Back squat’s weight"; "Used by no field yet." when none). A quiet IconButton, Lucide `pencil`, named "Change Squat start", opens it.
- **Open:** in place, in the ActivityCard's open frame (2px `ink`, `radius-lg`), its head reading "Squat start" over "40 kg by default, from 20 to 200 kg"; pressing the head closes it. The fields:
  - **Label** (TextField).
  - **Unit** (TextField, 110u) and **Default** on one row; the default's unit follows Unit.
  - **Lowest** and **Highest** on one row, then the hint "Lowest and highest are optional. The start asks for a value between them."
  - **The Used by line** in `caption` `ink`: "Used by Back squat’s weight."
  - **More: key**, a disclosure that opens **Key** (TextField; hint "A start through Claude names the value by it. Lowercase letters, numbers and dashes."). A value added in this session takes its key from its label until the key is edited; a loaded one keeps its key (spec F5). A changed key follows into every field that uses it.
  - **Remove** (quiet, Lucide `trash-2`). While a field uses the value, Remove is refused (spec F7): an InlineMessage (error) under it names the field: "Back squat’s weight uses Squat start. Give that field a number first, then remove it." Unused, it removes the value at once and focus moves to Add a value.
- **A problem** shows under its field, as TextField's error (a default outside lowest and highest, a key in use).
- **Sizes:** at u = 1, labels and text 19u, fields 60u, the number fields 140u wide. **Folded**, the system's n sizes: labels 16n, text 18n, fields 48px.

## States

| State | Look |
| --- | --- |
| Closed | The row with its pencil |
| Closed, unused | "Used by no field yet." |
| Open | The ink frame; the fields, the Used by line, More: key, Remove |
| More open | Key under the link |
| Remove refused | The InlineMessage (error) under Remove |

## Accessibility

- The pencil is named for the value ("Change Squat start") and has `aria-expanded`. Opened, focus moves to Label; closing returns it to the pencil.
- The open body is a `group` labelled by the value's label. More is a disclosure with `aria-expanded`.
- The refusal is `role="alert"` and describes Remove (`aria-describedby`), so it is read when it appears.
- Contrast, measured by the gate in both themes: `ink`, `ink-secondary` and `error-ink` on `canvas`, `ink` on `canvas` for the frame, `control-border` and `focus` on `canvas`.

## For the app

`src/components/StartValueEditor.vue` (W6). Test ids, as in the preview:

| Element | Test id |
| --- | --- |
| A value | `start-value` with `data-param="<key>"`; its pencil `start-value-open` |
| The fields | `start-value-label`, `start-value-unit`, `start-value-default`, `start-value-min`, `start-value-max`, `start-value-more`, `start-value-key` |
| Used by | `start-value-used` |
| Remove | `start-value-remove`; the refusal `start-value-refused` |
| Add a value | `start-value-add` |

## You provide

The parameter as the draft holds it (key, label, unit, default, min, max), the fields that use it, by activity and field name (the draft model's), its problems (each a path and a sentence), and handlers that write each change to its path and remove it.
