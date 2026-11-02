import MarkdownIt from 'markdown-it'

/**
 * An item's note, in markdown (K43). Raw HTML is never rendered (it shows as the text it is), and
 * markdown-it's own link check refuses `javascript:`, `vbscript:`, `file:` and most `data:` links.
 * A note is a few lines, so it keeps emphasis, links, code, lists and quotes, and leaves out what
 * would make it a page: images, headings, tables and rules. Bare URLs become links.
 */
function notes(): MarkdownIt {
  return new MarkdownIt({ html: false, linkify: true, breaks: true }).disable([
    'image',
    'heading',
    'lheading',
    'table',
    'hr',
  ])
}

/** The whole note, for the popover: every link opens in a new tab and tells it nothing. */
const whole = notes()
whole.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  tokens[idx]!.attrSet('target', '_blank')
  tokens[idx]!.attrSet('rel', 'noopener noreferrer')
  return self.renderToken(tokens, idx, options)
}

/**
 * The note's one line in the row: inline formatting only, with its line breaks as spaces. The line
 * is a button that opens the whole note, and a link can't sit inside a button, so a link shows as
 * its underlined text here and works in the popover.
 */
const line = notes()
line.renderer.rules.link_open = () => '<span class="note-link">'
line.renderer.rules.link_close = () => '</span>'

/**
 * An answer on the Ask page (Transcript card, F8), in the markdown Claude writes. Raw HTML stays
 * text and markdown-it's link check drops `javascript:`, `vbscript:`, `file:` and most `data:`
 * links, as in a note; every link opens in a new tab and tells it nothing. It keeps paragraphs,
 * lists, emphasis, inline code, quotes and code blocks. The system prompt asks for no headings,
 * tables or images (api ask.py), so when one comes anyway:
 *
 * - a heading becomes a bold paragraph, so its words still read as a lead-in rather than "## …";
 * - a table stays its text: alignment would add `style` attributes, and a wide table would scroll
 *   the page sideways on a phone;
 * - a rule is left out, since the paragraphs already part and the rows have their own hairlines;
 * - an image is never fetched (its words and link stay).
 *
 * It renders a half-streamed chunk as it stands: an unclosed `**` shows as its asterisks until the
 * closing pair arrives.
 */
const answers = new MarkdownIt({ html: false, linkify: true }).disable(['image', 'table'])
answers.renderer.rules.link_open = whole.renderer.rules.link_open
answers.renderer.rules.heading_open = () => '<p><strong>'
answers.renderer.rules.heading_close = () => '</strong></p>\n'
answers.renderer.rules.hr = () => ''

export function answer(src: string): string {
  return answers.render(src)
}

export function renderNote(src: string): string {
  return whole.render(src)
}

export function renderNoteLine(src: string): string {
  return line.renderInline(src.replace(/\s*\n\s*/g, ' '))
}
