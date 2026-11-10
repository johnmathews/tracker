import type { Component } from 'vue'
import ColourSection from './sections/ColourSection.vue'
import TypeSection from './sections/TypeSection.vue'
import ButtonSection from './sections/ButtonSection.vue'
import IconButtonSection from './sections/IconButtonSection.vue'
import BarActionSection from './sections/BarActionSection.vue'
import BrandMarkSection from './sections/BrandMarkSection.vue'
import TextLinkSection from './sections/TextLinkSection.vue'
import TextFieldSection from './sections/TextFieldSection.vue'
import TextAreaSection from './sections/TextAreaSection.vue'
import SegmentedControlSection from './sections/SegmentedControlSection.vue'
import RadioCardSection from './sections/RadioCardSection.vue'
import SwitchSection from './sections/SwitchSection.vue'
import StepperSection from './sections/StepperSection.vue'
import PopoverSection from './sections/PopoverSection.vue'
import MenuSection from './sections/MenuSection.vue'
import DialogSection from './sections/DialogSection.vue'
import ConfirmDialogSection from './sections/ConfirmDialogSection.vue'
import InlineMessageSection from './sections/InlineMessageSection.vue'
import BannerSection from './sections/BannerSection.vue'
import DayMarkSection from './sections/DayMarkSection.vue'
import ChipSection from './sections/ChipSection.vue'
import SectionHeaderSection from './sections/SectionHeaderSection.vue'
import WeekGridSection from './sections/WeekGridSection.vue'
import RecentWeeksSection from './sections/RecentWeeksSection.vue'
import ItemPageSection from './sections/ItemPageSection.vue'
import TranscriptSection from './sections/TranscriptSection.vue'
import AnswerProgressSection from './sections/AnswerProgressSection.vue'
import QuotaChipSection from './sections/QuotaChipSection.vue'
import SidePanelSection from './sections/SidePanelSection.vue'
import HistoryListSection from './sections/HistoryListSection.vue'

/**
 * One section of the style guide. StyleGuide.vue renders each as
 * `<section id="{id}"><h2 id="{id}-title">{title}</h2><p>{summary}</p><component /></section>`
 * and lists it in the contents, so adding a component is one entry in SECTIONS below.
 */
export interface StyleGuideSection {
  /** The section's anchor, `sg-` and the component's name in kebab case (`sg-text-field`). */
  id: `sg-${string}`
  /** The component's name, shown as the section's heading. */
  title: string
  /** One sentence: what it is for (the first sentence of its card's README). */
  summary: string
  /**
   * Renders the real component in every state its card shows (brand/design-system/project/
   * components/<Name>/preview.html), in the card's copy, each state captioned. One canonical
   * instance per state carries an id `{section id}-{variant}-{state}` (`sg-button-primary-busy`)
   * for the browser checks; every interactive example has an accessible name; nothing in it may
   * be wider than a 375px viewport. Hover cannot be forced, so it is left to the pointer.
   */
  component: Component
}

/** The sections in page order: foundations, then the components as the system groups them. */
export const SECTIONS: readonly StyleGuideSection[] = [
  {
    id: 'sg-colour',
    title: 'Colour',
    summary: 'The roles every component draws with, in the current theme.',
    component: ColourSection,
  },
  {
    id: 'sg-type',
    title: 'Type',
    summary: 'Source Serif 4 for headings and notes, Source Sans 3 for everything else.',
    component: TypeSection,
  },
  {
    id: 'sg-button',
    title: 'Button',
    summary:
      'The text button in three weights: primary for the one action a step exists for, secondary for the other choices beside it, and quiet for the least of them.',
    component: ButtonSection,
  },
  {
    id: 'sg-icon-button',
    title: 'IconButton',
    summary:
      'A 44px square button that shows one Lucide icon and carries its meaning in an accessible label.',
    component: IconButtonSection,
  },
  {
    id: 'sg-bar-action',
    title: 'BarAction',
    summary:
      'A tile in the Header for one of its actions: a Lucide icon with its name under it, as big as the week below it.',
    component: BarActionSection,
  },
  {
    id: 'sg-brand-mark',
    title: 'BrandMark',
    summary: 'The product’s name as a mark: the “Tracker” wordmark in Source Serif 4 600.',
    component: BrandMarkSection,
  },
  {
    id: 'sg-text-link',
    title: 'TextLink',
    summary:
      'A link in ink with a visible underline, for going somewhere rather than doing something.',
    component: TextLinkSection,
  },
  {
    id: 'sg-text-field',
    title: 'TextField',
    summary:
      'A single-line input with its label always visible above it, an optional hint below, and an error that says what happened and what to do.',
    component: TextFieldSection,
  },
  {
    id: 'sg-text-area',
    title: 'TextArea',
    summary:
      "A multi-line input that follows TextField's label, hint and error rules, for text longer than a line.",
    component: TextAreaSection,
  },
  {
    id: 'sg-segmented-control',
    title: 'SegmentedControl',
    summary:
      'A row of two or three toggle buttons, exactly one chosen, for a setting whose options all fit on screen at once.',
    component: SegmentedControlSection,
  },
  {
    id: 'sg-radio-card',
    title: 'RadioCard',
    summary:
      'A list of choices, exactly one chosen, each a bordered row with a radio dot, its name and a picture of what it chooses, for a setting best decided by seeing the options.',
    component: RadioCardSection,
  },
  {
    id: 'sg-switch',
    title: 'Switch',
    summary:
      'An on/off control that takes effect at once, with its label inside the same 44px button.',
    component: SwitchSection,
  },
  {
    id: 'sg-stepper',
    title: 'Stepper',
    summary:
      'A small whole number changed one step at a time: a minus button, the value, and a plus button.',
    component: StepperSection,
  },
  {
    id: 'sg-popover',
    title: 'Popover',
    summary:
      'A small panel attached to the control that opened it; the app has one, Settings, under the settings IconButton in the Header.',
    component: PopoverSection,
  },
  {
    id: 'sg-menu',
    title: 'Menu',
    summary:
      'A short list of actions that opens under the control that pressed it, with an optional line at the top saying whose they are.',
    component: MenuSection,
  },
  {
    id: 'sg-dialog',
    title: 'Dialog',
    summary:
      'A modal panel for one focused task over a dimmed page. Nothing in the app opens one since K104.',
    component: DialogSection,
  },
  {
    id: 'sg-confirm-dialog',
    title: 'ConfirmDialog',
    summary:
      "A small modal question before something that can't be undone: what will happen, then two buttons.",
    component: ConfirmDialogSection,
  },
  {
    id: 'sg-inline-message',
    title: 'InlineMessage',
    summary:
      'A one- or two-line message next to the thing it is about, in one of four tones, always an icon and words together.',
    component: InlineMessageSection,
  },
  {
    id: 'sg-banner',
    title: 'Banner',
    summary:
      'A full-width bar above the week that says how the data stands with the server, in words, with the one action that helps.',
    component: BannerSection,
  },
  {
    id: 'sg-day-mark',
    title: 'DayMark',
    summary:
      'One day of one exercise or food: a box drawn as if on a whiteboard, filled with a marker in green, yellow or red when it’s marked and empty when it isn’t, and the button that steps between them.',
    component: DayMarkSection,
  },
  {
    id: 'sg-chip',
    title: 'Chip',
    summary:
      'A small quiet tag under an exercise name that says how much: sets × reps, each side, or the weight.',
    component: ChipSection,
  },
  {
    id: 'sg-section-header',
    title: 'SectionHeader',
    summary:
      'The heading over a WeekGrid: the section’s name in serif, the week beside it, and an optional line of hint.',
    component: SectionHeaderSection,
  },
  {
    id: 'sg-week-grid',
    title: 'WeekGrid',
    summary:
      'One week, Monday to Sunday, as a grid: a row per item, its name a link to its page, and a DayMark per day.',
    component: WeekGridSection,
  },
  {
    id: 'sg-recent-weeks',
    title: 'RecentWeeks',
    summary:
      'An item’s last eight weeks, newest first, one line a week: when, its seven marks, and the count against that week’s goal.',
    component: RecentWeeksSection,
  },
  {
    id: 'sg-item-page',
    title: 'ItemPage',
    summary:
      'An item’s own page, in rows like Settings: this week’s plan first, then its notes, details and recent weeks. In Edit plan it also renames, removes and adds.',
    component: ItemPageSection,
  },
  {
    id: 'sg-transcript',
    title: 'Transcript',
    summary:
      'The conversation on the Ask page, in rows like Settings: each question in the left column and its answer to the right, at a reading measure, with hairlines between the rows.',
    component: TranscriptSection,
  },
  {
    id: 'sg-answer-progress',
    title: 'AnswerProgress',
    summary:
      'The line that shows an answer is on its way: a pen of three short strokes, then the words “Reading your weeks…”.',
    component: AnswerProgressSection,
  },
  {
    id: 'sg-quota-chip',
    title: 'QuotaChip',
    summary:
      'A Chip under the question box that says how many questions are left today, in words from three down.',
    component: QuotaChipSection,
  },
  {
    id: 'sg-side-panel',
    title: 'SidePanel',
    summary:
      'A full-height panel beside the page that hides to a strip of icons, and becomes a drawer over the page on a phone; the Ask page keeps its history in it.',
    component: SidePanelSection,
  },
  {
    id: 'sg-history-list',
    title: 'HistoryList',
    summary:
      'The past conversations inside the SidePanel on the Ask page: “New conversation”, then every conversation grouped by Today, Last week and Earlier, and “Delete all conversations” at the foot.',
    component: HistoryListSection,
  },
]
