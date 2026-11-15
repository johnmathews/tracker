<script setup lang="ts">
import { ref } from 'vue'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useConfirm, type ConfirmOptions } from '@/composables/useConfirm'
import ExampleGroup from '../parts/ExampleGroup.vue'
import StateExample from '../parts/StateExample.vue'

/** The app's three cases, in the card's words (components/ConfirmDialog/README.md). */
const CASES: readonly { id: string; state: string; trigger: string; ask: ConfirmOptions }[] = [
  {
    id: 'sg-confirm-dialog-remove-open',
    state: 'Removing an exercise',
    trigger: 'Remove Push-ups',
    ask: {
      title: 'Remove Push-ups?',
      message:
        'Remove ‘Push-ups’ from this week’s plan and also future weeks. History is unchanged and existing data is not removed.',
      confirmLabel: 'Remove',
    },
  },
  {
    id: 'sg-confirm-dialog-sign-out-open',
    state: 'Signing out with changes not yet synced',
    trigger: 'Sign out',
    ask: {
      title: 'Sign out now?',
      message:
        "Two changes on this device haven't reached the server yet. Signing out now loses them.",
      confirmLabel: 'Sign out',
    },
  },
]

const { confirm } = useConfirm()
const answer = ref('')

// Through useConfirm and the one <ConfirmHost /> (StyleGuide.vue), as the app asks.
async function ask(options: ConfirmOptions): Promise<void> {
  const yes = await confirm(options)
  answer.value = `“${options.title}” answered ${yes ? options.confirmLabel : 'Cancel'}.`
}

// The direct component, for the states the host never shows: the first confirm is busy and then
// fails with an error; the next one is busy and then closes.
const open = ref(false)
const busy = ref(false)
const error = ref<string>()
const tries = ref(0)

function openDirect(): void {
  tries.value = 0
  error.value = undefined
  open.value = true
}

function onConfirm(): void {
  busy.value = true
  error.value = undefined
  setTimeout(() => {
    busy.value = false
    tries.value += 1
    if (tries.value === 1) {
      error.value =
        "Couldn't sign out: the server didn't answer. Check your connection and try again."
    } else {
      open.value = false
    }
  }, 1200)
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <ExampleGroup title="Through useConfirm()">
      <StateExample v-for="c in CASES" :key="c.id" :state="c.state">
        <Button :id="c.id" @click="ask(c.ask)">{{ c.trigger }}</Button>
      </StateExample>
    </ExampleGroup>
    <p id="sg-confirm-dialog-answer" class="caption text-ink-secondary" aria-live="polite">
      {{ answer || 'The answer shows here.' }}
    </p>
    <ExampleGroup title="Busy, then an error">
      <StateExample state="Confirm once for the error, again to close">
        <Button id="sg-confirm-dialog-direct-open" @click="openDirect">Sign out</Button>
      </StateExample>
    </ExampleGroup>
    <ConfirmDialog
      v-model:open="open"
      title="Sign out now?"
      message="Two changes on this device haven't reached the server yet. Signing out now loses them."
      confirm-label="Sign out"
      :busy="busy"
      :error="error"
      @confirm="onConfirm"
    />
  </div>
</template>
