<!-- eslint-disable vue/multi-word-component-names -- the design system's name; it lives in components/ui/ -->
<script setup lang="ts">
import { useId } from 'vue'
import { RotateCcw } from '@lucide/vue'
import { answer } from '@/lib/markdown'
import { AnswerProgress } from '@/components/ui/answer-progress'
import { Button } from '@/components/ui/button'
import { InlineMessage } from '@/components/ui/inline-message'
import { withCaret, type TranscriptTurn } from '.'

const props = withDefaults(
  defineProps<{
    turns: readonly TranscriptTurn[]
    /** AnswerProgress's words while an answer has none yet. */
    progressLabel?: string
    /** The log's accessible name. */
    label?: string
  }>(),
  { progressLabel: undefined, label: 'Conversation' },
)

const emit = defineEmits<{
  /** Try again on a failed turn, by its index in `turns`. */
  retry: [index: number]
}>()

const base = useId()

function html(turn: TranscriptTurn): string {
  const rendered = answer(turn.answer)
  return turn.state === 'streaming' ? withCaret(rendered) : rendered
}

function waiting(turn: TranscriptTurn): boolean {
  return turn.state === 'streaming' && turn.answer === ''
}

/** The answer's text from the Transcript card: the page's body size at a reading measure. */
const ANSWER = [
  'min-w-0 text-(length:--set-text) leading-[1.55] wrap-break-word text-ink',
  '[&>*]:mb-[0.6em] [&>:last-child]:mb-0 [&_p]:max-w-[68ch]',
  '[&_ol]:max-w-[64ch] [&_ol]:list-decimal [&_ol]:pl-[1.2em] [&_ul]:max-w-[64ch] [&_ul]:list-disc [&_ul]:pl-[1.2em] [&_li]:my-[0.2em]',
  '[&_strong]:font-semibold',
  '[&_a]:rounded-[2px] [&_a]:underline [&_a]:decoration-1 [&_a]:underline-offset-3 [&_a:hover]:decoration-2',
  '[&_code]:rounded-sm [&_code]:bg-tile [&_code]:px-[0.25em] [&_code]:text-[0.9em]',
  '[&_pre]:rounded-sm [&_pre]:bg-tile [&_pre]:p-3 [&_pre]:whitespace-pre-wrap [&_pre_code]:px-0',
  '[&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-[0.75em]',
].join(' ')
</script>

<!--
  The conversation on the Ask page (brand/design-system/project/components/Transcript), layout A:
  a row per turn, the question in the left column and the answer at a reading measure to its
  right, a hairline opening each row. Folded, the question sits over its answer. One polite log;
  a streaming answer is aria-busy, so a screen reader reads it whole rather than piece by piece.
-->
<template>
  <div data-slot="transcript" role="log" aria-live="polite" :aria-label="label">
    <article
      v-for="(turn, i) in props.turns"
      :key="turn.id ?? i"
      data-slot="transcript-turn"
      :data-state="turn.state"
      :aria-labelledby="`${base}-q${i}`"
      class="grid grid-cols-[calc(var(--u)*240)_minmax(0,1fr)] items-start gap-x-[calc(var(--u)*24)] border-t border-line py-[calc(var(--u)*28)] folded:grid-cols-[minmax(0,1fr)] folded:gap-y-2.5 folded:py-5"
    >
      <p
        :id="`${base}-q${i}`"
        data-slot="transcript-question"
        class="label pt-[calc(var(--u)*2)] text-(length:--set-label) leading-[1.4] wrap-anywhere text-ink"
      >
        {{ turn.question }}
      </p>
      <div class="min-w-0">
        <p
          v-if="turn.read"
          data-slot="transcript-read"
          class="caption mb-[calc(var(--u)*10)] text-[max(16px,calc(var(--u)*16))] leading-[1.4] text-ink-secondary"
        >
          {{ turn.read }}
        </p>
        <AnswerProgress v-if="waiting(turn)" :label="progressLabel" />
        <!-- eslint-disable-next-line vue/no-v-html -- markdown-it with raw HTML off (lib/markdown) -->
        <div
          v-else-if="turn.answer !== ''"
          data-slot="transcript-answer"
          :aria-busy="turn.state === 'streaming' ? 'true' : undefined"
          :class="ANSWER"
          v-html="html(turn)"
        ></div>
        <InlineMessage
          v-if="turn.message && (turn.state === 'stopped' || turn.state === 'error')"
          :tone="turn.state === 'error' ? 'error' : 'info'"
          :class="turn.answer === '' ? undefined : 'mt-[0.6em]'"
        >
          {{ turn.message }}
        </InlineMessage>
        <Button v-if="turn.state === 'error'" class="mt-3" @click="emit('retry', i)">
          <RotateCcw :stroke-width="1.5" />Try again
        </Button>
      </div>
    </article>
  </div>
</template>
