import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { Transcript, withCaret, type TranscriptTurn } from '@/components/ui/transcript'

const Q1 = 'Am I doing enough to meet my goals this month?'
const A1 = 'Mostly, yes. **Push-ups** met four days.\n\n- Squats\n- Pull-ups'
const READ = 'Read this week and the three before it, and your goals.'

const done: TranscriptTurn = { id: 'a', question: Q1, answer: A1, state: 'done', read: READ }

function turns(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('[data-slot="transcript-turn"]')
}

describe('Transcript', () => {
  it('is one polite log, named, holding a row per turn', () => {
    const log = mount(Transcript, {
      props: {
        turns: [done, { question: 'Is my diet good enough?', answer: 'Yes.', state: 'done' }],
      },
    })
    expect(log.attributes('role')).toBe('log')
    expect(log.attributes('aria-live')).toBe('polite')
    expect(log.attributes('aria-label')).toBe('Conversation')
    expect(turns(log)).toHaveLength(2)
    expect(
      mount(Transcript, { props: { turns: [], label: 'Is my diet good enough?' } }).attributes(
        'aria-label',
      ),
    ).toBe('Is my diet good enough?')
  })

  it('names each turn by its question, in the left column, the answer rendered beside it', () => {
    const turn = turns(mount(Transcript, { props: { turns: [done] } }))[0]!
    expect(turn.element.tagName).toBe('ARTICLE')
    const question = turn.get('[data-slot="transcript-question"]')
    expect(question.text()).toBe(Q1)
    expect(turn.attributes('aria-labelledby')).toBe(question.attributes('id'))
    expect(turn.get('[data-slot="transcript-read"]').text()).toBe(READ)
    const answer = turn.get('[data-slot="transcript-answer"]')
    expect(answer.html()).toContain('<strong>Push-ups</strong>')
    expect(answer.findAll('li')).toHaveLength(2)
    expect(answer.attributes('aria-busy')).toBeUndefined()
    expect(turn.find('[data-caret]').exists()).toBe(false)
    expect(turn.find('[data-slot="answer-progress"]').exists()).toBe(false)
    expect(turn.find('[data-slot="inline-message"]').exists()).toBe(false)
    expect(turn.find('button').exists()).toBe(false)
  })

  it('leaves the read line out when there is none', () => {
    const log = mount(Transcript, { props: { turns: [{ ...done, read: undefined }] } })
    expect(log.find('[data-slot="transcript-read"]').exists()).toBe(false)
  })

  it('renders raw HTML in an answer as text, through answer()', () => {
    const log = mount(Transcript, {
      props: {
        turns: [
          {
            question: 'Hi',
            answer: '<script>alert(1)</script> [x](javascript:alert(1))',
            state: 'done',
          },
        ],
      },
    })
    const answer = log.get('[data-slot="transcript-answer"]')
    expect(answer.find('script').exists()).toBe(false)
    expect(answer.find('a').exists()).toBe(false)
    expect(answer.text()).toContain('<script>alert(1)</script>')
  })

  it('shows AnswerProgress while an answer has no words yet', () => {
    const turn = turns(
      mount(Transcript, { props: { turns: [{ question: Q1, answer: '', state: 'streaming' }] } }),
    )[0]!
    expect(turn.get('[data-slot="answer-progress"]').text()).toBe('Reading your weeks…')
    expect(turn.find('[data-slot="transcript-answer"]').exists()).toBe(false)
  })

  it('passes other progress words through', () => {
    const log = mount(Transcript, {
      props: {
        turns: [{ question: Q1, answer: '', state: 'streaming' }],
        progressLabel: 'Reading your goals…',
      },
    })
    expect(log.get('[data-slot="answer-progress"]').text()).toBe('Reading your goals…')
  })

  it('streams with a hidden caret at the end of the last line, busy until done', async () => {
    const log = mount(Transcript, {
      props: { turns: [{ question: Q1, answer: 'Fruit is on **track', state: 'streaming' }] },
    })
    const answer = log.get('[data-slot="transcript-answer"]')
    expect(answer.attributes('aria-busy')).toBe('true')
    const caret = answer.get('p [data-caret]')
    expect(caret.attributes('aria-hidden')).toBe('true')
    expect(caret.classes()).toEqual(expect.arrayContaining(['bg-ink', 'inline-block']))
    expect(caret.attributes('class')).not.toMatch(/animate/)

    await log.setProps({
      turns: [{ question: Q1, answer: 'Fruit is on **track**.', state: 'done' }],
    })
    expect(log.find('[data-caret]').exists()).toBe(false)
    expect(log.get('[data-slot="transcript-answer"]').attributes('aria-busy')).toBeUndefined()
  })

  it('shows a stopped answer as far as it got, then the page’s words as info', () => {
    const turn = turns(
      mount(Transcript, {
        props: {
          turns: [
            {
              question: Q1,
              answer: 'Four of five',
              state: 'stopped',
              message: 'You stopped this answer.',
            },
          ],
        },
      }),
    )[0]!
    expect(turn.get('[data-slot="transcript-answer"]').text()).toBe('Four of five')
    expect(turn.find('[data-caret]').exists()).toBe(false)
    const message = turn.get('[data-slot="inline-message"]')
    expect(message.attributes('data-tone')).toBe('info')
    expect(message.attributes('role')).toBe('status')
    expect(message.text()).toBe('You stopped this answer.')
    expect(turn.find('button').exists()).toBe(false)
  })

  it('shows an error with what to do, and a Try again that names its turn', async () => {
    const message =
      'The answer stopped before it finished, because the AI service didn’t respond. Your question is kept.'
    const log = mount(Transcript, {
      props: {
        turns: [
          done,
          { id: 'b', question: 'Is my diet good enough?', answer: '', state: 'error', message },
        ],
      },
    })
    const turn = turns(log)[1]!
    expect(turn.find('[data-slot="transcript-answer"]').exists()).toBe(false)
    expect(turn.find('[data-slot="answer-progress"]').exists()).toBe(false)
    const alert = turn.get('[data-slot="inline-message"]')
    expect(alert.attributes('data-tone')).toBe('error')
    expect(alert.attributes('role')).toBe('alert')
    expect(alert.text()).toBe(message)
    const retry = turn.get('button')
    expect(retry.text()).toBe('Try again')
    expect(retry.attributes('data-variant')).toBe('secondary')
    await retry.trigger('click')
    expect(log.emitted('retry')).toEqual([[1]])
  })

  it('keeps what arrived before an error, and a Try again without words', () => {
    const turn = turns(
      mount(Transcript, { props: { turns: [{ question: Q1, answer: 'Mostly', state: 'error' }] } }),
    )[0]!
    expect(turn.get('[data-slot="transcript-answer"]').text()).toBe('Mostly')
    expect(turn.find('[data-slot="inline-message"]').exists()).toBe(false)
    expect(turn.get('button').text()).toBe('Try again')
  })

  it('sets the question in a 240u column beside the SidePanel (S1), a hairline opening the row, and folds', () => {
    const row = turns(mount(Transcript, { props: { turns: [done] } }))[0]!
    expect(row.classes()).toEqual(
      expect.arrayContaining([
        'grid-cols-[calc(var(--u)*240)_minmax(0,1fr)]',
        'border-t',
        'border-line',
        'folded:grid-cols-[minmax(0,1fr)]',
      ]),
    )
  })
})

describe('withCaret', () => {
  const CARET = '<span data-caret></span>'
  it.each([
    ['<p>One</p>\n', '<p>One' + CARET + '</p>\n'],
    [
      '<p>One</p>\n<ul>\n<li>A</li>\n<li>B</li>\n</ul>\n',
      '<p>One</p>\n<ul>\n<li>A</li>\n<li>B' + CARET + '</li>\n</ul>\n',
    ],
    [
      '<blockquote>\n<p>Q</p>\n</blockquote>\n',
      '<blockquote>\n<p>Q' + CARET + '</p>\n</blockquote>\n',
    ],
    ['<pre><code>x\n</code></pre>\n', '<pre><code>x\n</code></pre>\n' + CARET],
    ['', CARET],
  ])('puts the caret at the end of the last line of %j', (html, out) => {
    expect(withCaret(html, CARET)).toBe(out)
  })
})
