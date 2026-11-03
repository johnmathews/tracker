A list of choices, exactly one chosen, each a bordered row with a radio dot, its name and a picture of what it chooses or a line saying what it means, for a choice best decided by seeing or reading the options.

## Use

- **When:** four or more options, or options whose difference is a look rather than a word: the **Marks** setting, where each row shows its set's three marks. Also two or three options that each need a sentence to say what they mean, where the choice matters enough to read: what an app may do on the connect screen (ConnectPage). Two or three short words are a SegmentedControl; a single on/off is a Switch.
- **The list:** a visible label above it in `label` style ("Marks"), then the rows `space-2` apart, as wide as the column.
- **A row:** at least 76px tall, padding `space-1` by `space-3`, `radius-md`, a 1px `control-border` outline. In it, `space-3` apart: the radio dot (20px, a 1px `control-border` ring), the option's name in `body` `ink`, and the picture on the right (for Marks, the set's great, partly done and couldn't do it marks as DayMarks, `space-3` apart, drawn as the day's marks are and not pressable).
- **Chosen:** a 2px `ink` outline and dot ring, and a 10px `ink` dot in the ring. Never `pen`: pen means done.
- **With a line each:** in place of a picture, a `caption` line in `ink-secondary` under the name, which takes weight 600; the row's padding is `space-3` all round and the dot sits beside the name, not the middle of the row. Real use: **What Claude can do** on the connect screen, "Read only" ("See your plans, marks and notes.", chosen by default) and "Read and change" ("Also mark days, and add and edit items.").
- **Phone:** below 640px the picture moves under the name, lined up with it, so the row never squeezes the marks or their ink.
- Real use: **Marks** in Settings, Appearance: Squiggles, Ticks, Stamped ticks, Faces, Stamped faces (K20). Names in sentence case, short enough for one line.

## States

| State | Look |
| --- | --- |
| Unchosen | 1px `control-border` outline, an empty dot ring |
| Hover (unchosen) | `tile` fill |
| Chosen | 2px `ink` outline, the ring 2px `ink` with a 10px `ink` dot |
| Keyboard focus | solid 2px `focus` outline at 2px offset around the row |

Colour changes take 120ms at most, and none under `prefers-reduced-motion`. Settings take effect at once; there is no Save.

## Accessibility

- Built on Reka UI's RadioGroup: a `role="radiogroup"` labelled by the visible label (`aria-labelledby`), and each row a `role="radio"` button with `aria-checked`. Its name is the option's name; the picture is `aria-hidden`, and a line, when there is one, is the row's description (`aria-describedby`).
- Keyboard: Tab enters the group on the chosen row and Tab again leaves it; the arrow keys move to the next or previous row and choose it, as radio buttons do.
- The chosen row differs from the others by its outline's weight and the filled dot, not by colour.

## You provide

The label, the options as `{ value, label }` (with `hint`, the line, when the row says what it means), the chosen value (`v-model`), and the picture for each option (the `picture` slot, given the option).
