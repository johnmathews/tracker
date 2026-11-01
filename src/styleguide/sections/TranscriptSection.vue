<script setup lang="ts">
import { Transcript, type TranscriptTurn } from '@/components/ui/transcript'

/** The card's five states (components/Transcript/preview.html), in its copy. */
const TURNS: TranscriptTurn[] = [
  {
    id: 'done',
    question: 'Am I doing enough to meet my goals this month?',
    read: 'Read this week and the three before it, and your goals.',
    answer:
      'Mostly, yes. Over four weeks you met **Push-ups** and **Squats** every week, at four days each. **Pull-ups** met its four days twice; the other two weeks had three.\n\n' +
      'Your goal says “Ten pull-ups in a row by March”. Three or four days a week of three reps is steady, but the reps haven’t gone up since 12 October. One more rep a set every second week would get you there by March.',
    state: 'done',
  },
  {
    id: 'streaming',
    question: 'Is my diet good enough?',
    answer:
      'Fruit and Nuts are on track: five and three days most weeks. **Vegetables** is the gap: five days this week against a goal of seven',
    state: 'streaming',
  },
  { id: 'waiting', question: 'How steady was October?', answer: '', state: 'streaming' },
  {
    id: 'stopped',
    question: 'Should I add a rest day?',
    answer: 'Four of your five exercises are at their days most weeks, and',
    state: 'stopped',
    message: 'You stopped this answer.',
  },
  {
    id: 'error',
    question: 'Am I eating enough fish?',
    answer: '',
    state: 'error',
    message:
      'The answer stopped before it finished, because the AI service didn’t respond. Your question is kept.',
  },
]
</script>

<!-- Done, streaming (the caret), waiting (AnswerProgress), stopped and error, in layout A's rows.
     Narrow the window under 760px to see the question fold over its answer. Try again does
     nothing here. -->
<template>
  <Transcript id="sg-transcript-states" :turns="TURNS" />
</template>
