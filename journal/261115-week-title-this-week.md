# The week title, and View current week next to the arrow

John, 2026-11-15: "an option in settings to show either the start - end date of the current week
(as it is currently) or the week number", and "the \"this week\" button in the navbar next to the
week selector button ( the `>`)".

## 1. What changed

- **View current week (K130).** A secondary Button in words after the bar's › arrow, inside the Week nav,
  only while another week is on screen. It was a BarAction at the bar's end (K81). In the week
  view the bar is out of sight, so the same Button follows the band's title, the two centred
  together. It never shows in the band in Edit plan, on a short screen or on paper, so it is never
  focusable out of sight. John renamed it from "This week" on the mockup: "the button is an
  action. its a \"GO to this week\". so the wording should be active."
- **Week title (K131).** Settings › Appearance has "Week title" after Theme: a SegmentedControl
  with "Date" and "Week number" (John's words; round 1 showed this week's own titles). The number is the ISO
  week, with the week-year after a comma when it isn't the current one ("Week 1, 2027"). The bar,
  the band and print follow it. A screen reader hears the dates after the number.
- **Saved with the account (K132).** `weekTitle` (`dates` or `number`) is a settings column at
  schema 17, synced and carried in Export and Import like Daily goal (K85). Marks and Theme stay
  on the device.
- **← and → (K133).** On the local check John asked: "lets make the left and right arrows go to
  the previous or next week". They join the week's keys (K91), and leave the arrows to a grid,
  a SegmentedControl, tabs, a menu, a list or a slider while focus is in one.
- Mockup `261115-week-title-this-week`: A of three placements, S1 of two controls; round 2
  renamed both and picked P2 for the phone.

## 2. Calls made on the way

- **The phone's room.** On a 390px phone, "‹ 21–27 September ›" leaves no room after the arrow
  for a worded button, so the bar's Week nav wraps it under the week. The band has no arrows, and
  "This week" (102px) fitted beside the title once the title shrank a little. "View current week"
  is 165px: beside "20–26 October 2025" the title would drop to about 19.5px. John picked P2: on
  a phone the button sits under the title, and `--week-band` grows by its height plus 6px while
  it shows (`:has()` on the band's `data-other-week`), so the screens start under it. The rule
  leaves out short screens, where the band is 0px.
- **ISO week-years.** 2026 has 53 weeks; 28 Dec 2026 – 3 Jan 2027 is its week 53. The year after
  the number compares ISO week-years, so this week never carries one, even on 2 January.
- **Escape twice.** After Esc leaves Edit plan, focus stays on the arrow, so the bar floats over
  the band until a second Esc takes focus out (Header card, Out of sight). The e2e helper presses
  both.

## 3. Left for later

- Changing weeks many times in a row logs "ResizeObserver loop completed with undelivered
  notifications" from the dev server. It happens without the band change too, and the browser
  treats it as harmless.
