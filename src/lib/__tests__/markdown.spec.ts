import { describe, expect, it } from 'vitest'
import { answer, renderNote, renderNoteLine } from '@/lib/markdown'

describe('renderNote (K43)', () => {
  it('renders emphasis, code, lists and links, each link opening in a new tab', () => {
    expect(renderNote('**Ribs down.** Keep it *slow*, `3 s` down')).toBe(
      '<p><strong>Ribs down.</strong> Keep it <em>slow</em>, <code>3 s</code> down</p>\n',
    )
    expect(renderNote('- left\n- right')).toBe('<ul>\n<li>left</li>\n<li>right</li>\n</ul>\n')
    expect(renderNote('[Form video](https://example.com/push-ups)')).toBe(
      '<p><a href="https://example.com/push-ups" target="_blank" rel="noopener noreferrer">Form video</a></p>\n',
    )
  })

  it('turns a bare URL into a link, and keeps a line break', () => {
    expect(renderNote('See https://example.com\nthen rest')).toBe(
      '<p>See <a href="https://example.com" target="_blank" rel="noopener noreferrer">https://example.com</a><br>\nthen rest</p>\n',
    )
  })

  it('never renders raw HTML, a script link or an image', () => {
    expect(renderNote('<script>alert(1)</script>')).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>\n',
    )
    expect(renderNote('<img src=x onerror=alert(1)>')).not.toContain('<img')
    expect(renderNote('[click](javascript:alert(1))')).not.toContain('<a')
    expect(renderNote('![a cat](https://example.com/cat.png)')).not.toContain('<img')
  })

  it('leaves headings and rules as text: a note is not a page', () => {
    expect(renderNote('# Big')).toBe('<p># Big</p>\n')
    expect(renderNote('---')).toBe('<p>---</p>\n')
  })
})

describe('renderNoteLine (K43)', () => {
  it('keeps inline formatting on one line, a link as its underlined text', () => {
    expect(renderNoteLine('Slow **down**.\n[Form video](https://example.com)')).toBe(
      'Slow <strong>down</strong>. <span class="note-link">Form video</span>',
    )
  })

  it('escapes raw HTML here too', () => {
    expect(renderNoteLine('<b>bold</b>')).toBe('&lt;b&gt;bold&lt;/b&gt;')
  })
})

describe('answer (F8)', () => {
  it('renders paragraphs, lists, emphasis and inline code', () => {
    expect(answer('Mostly, yes. **Push-ups** met *four* days, at `3 × 12`.\n\nOne more rep.')).toBe(
      '<p>Mostly, yes. <strong>Push-ups</strong> met <em>four</em> days, at <code>3 × 12</code>.</p>\n<p>One more rep.</p>\n',
    )
    expect(answer('- Fruit\n- Nuts')).toBe('<ul>\n<li>Fruit</li>\n<li>Nuts</li>\n</ul>\n')
    expect(answer('1. Rest\n2. Stretch')).toBe('<ol>\n<li>Rest</li>\n<li>Stretch</li>\n</ol>\n')
  })

  it('opens every link in a new tab that is told nothing', () => {
    expect(answer('[NHS guidance](https://www.nhs.uk/live-well/exercise/)')).toBe(
      '<p><a href="https://www.nhs.uk/live-well/exercise/" target="_blank" rel="noopener noreferrer">NHS guidance</a></p>\n',
    )
    expect(answer('See https://example.com')).toContain(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">',
    )
  })

  it('renders <script> and other raw HTML as text', () => {
    expect(answer('<script>alert(1)</script>')).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>\n',
    )
    const html = answer('Try <b onclick="x()">this</b> <iframe src="https://example.com"></iframe>')
    expect(html).not.toMatch(/<b\b|<iframe/)
    expect(html).toContain('&lt;b onclick=&quot;x()&quot;&gt;')
  })

  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'vbscript:x',
    'data:text/html;base64,PHNjcmlwdD4=',
  ])('drops a %s link, keeping its words', (href) => {
    const html = answer(`[click](${href})`)
    expect(html).not.toContain('<a')
    expect(html).toContain('click')
  })

  it('never renders an image', () => {
    expect(answer('![a chart](https://example.com/chart.png)')).not.toContain('<img')
  })

  it('sets a heading as a bold paragraph, at any level and in either syntax', () => {
    expect(answer('## This week\n\nMostly, yes.')).toBe(
      '<p><strong>This week</strong></p>\n<p>Mostly, yes.</p>\n',
    )
    expect(answer('# Food')).toBe('<p><strong>Food</strong></p>\n')
    expect(answer('Food\n====')).toBe('<p><strong>Food</strong></p>\n')
  })

  it('leaves a table as its text, and a rule out', () => {
    const table = answer('| Item | Days |\n| --- | --- |\n| Fruit | 5 |')
    expect(table).not.toMatch(/<table|style=/)
    expect(table).toContain('| Fruit | 5 |')
    expect(answer('One.\n\n---\n\nTwo.')).toBe('<p>One.</p>\n<p>Two.</p>\n')
  })

  it.each([
    '**Vegetables',
    'Fruit and *Nu',
    '- Fruit\n- ',
    '[NHS](https://www.nh',
    '`3 ×',
    '##',
    '',
  ])('renders the half-streamed chunk %j without throwing', (chunk) => {
    expect(() => answer(chunk)).not.toThrow()
  })

  it('shows an unclosed ** as its asterisks until the pair arrives', () => {
    expect(answer('**Vegetables is the')).toBe('<p>**Vegetables is the</p>\n')
    expect(answer('**Vegetables** is the')).toBe('<p><strong>Vegetables</strong> is the</p>\n')
  })
})
