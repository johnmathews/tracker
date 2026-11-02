export { default as Transcript } from './Transcript.vue'

/** One question and its answer on the Ask page (brand/design-system/project/components/Transcript). */
export interface TranscriptTurn {
  /** Keeps the row stable as turns are added; the index is used when there is none. */
  id?: string | number
  question: string
  /** The answer in markdown, as far as it has come. */
  answer: string
  /**
   * done: the whole answer. streaming: arriving, with a caret (AnswerProgress until the first
   * words). stopped: cut short on purpose, with `message` as info. error: failed, with `message`
   * as an error and Try again.
   */
  state: 'done' | 'streaming' | 'stopped' | 'error'
  /** One quiet line over the answer: what was read to write it. */
  read?: string
  /** For a stopped or failed turn: what happened, then what to do. */
  message?: string
}

/** The caret at the end of a streaming answer: a still block of ink, hidden from screen readers. */
export const CARET =
  '<span data-caret aria-hidden="true" class="ml-0.5 inline-block h-[1em] w-[0.5em] bg-ink align-[-0.12em]"></span>'

/**
 * Puts `caret` at the end of the rendered answer's last line: inside the last paragraph or list
 * item when the HTML ends with one, and after everything otherwise (a code block, or nothing yet).
 */
export function withCaret(html: string, caret: string = CARET): string {
  const end = /(?:<\/(?:p|li|ul|ol|blockquote)>\s*)+$/.exec(html)
  return end ? html.slice(0, end.index) + caret + html.slice(end.index) : html + caret
}
