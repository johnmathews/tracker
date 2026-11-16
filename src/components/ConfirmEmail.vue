<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useSessionStore, type AuthProblem } from '@/stores/session'
import { describeProblem } from '@/lib/problems'
import AuthCard from '@/components/AuthCard.vue'
import { Button } from '@/components/ui/button'
import { InlineMessage } from '@/components/ui/inline-message'
import { TextLink } from '@/components/ui/text-link'

const props = defineProps<{ token: string }>()
const emit = defineEmits<{
  /** The link was used or can never work, so its token can leave the address bar. */
  spent: []
  /** The person left for the planner, or for sign-in. */
  leave: []
}>()

const session = useSessionStore()
const address = ref<string | null>(null)
const problem = ref<AuthProblem | null>(null)
const busy = ref(false)

const title = computed(() => {
  if (address.value) return 'Email confirmed'
  if (!problem.value) return 'Confirming your email…'
  return problem.value.code === 'gone' ? 'Link not valid' : 'Couldn’t check the link'
})
// Offline or busy: the link may be fine, so offer to try again rather than give up on it.
const canRetry = computed(() => problem.value !== null && problem.value.code !== 'gone')
// A new link comes from the banner over the week, which only a signed-in person sees.
const goneText = computed(
  () =>
    `This link has expired or was already used. ${session.status === 'signed-in' ? 'Choose' : 'Sign in and choose'} “Send it again” for a new one.`,
)
const onward = computed(() => (session.status === 'signed-in' ? 'Go to the week' : 'Go to sign in'))

async function check(): Promise<void> {
  busy.value = true
  problem.value = null
  const result = await session.confirmEmail(props.token)
  busy.value = false
  if ('code' in result) {
    problem.value = result
    if (result.code === 'gone') emit('spent')
    return
  }
  address.value = result.username
  emit('spent')
}

onMounted(check)
</script>

<template>
  <AuthCard :title="title">
    <template v-if="address">
      <p class="body text-ink-secondary" data-testid="confirm-done">
        Password resets for <strong class="font-semibold text-ink">{{ address }}</strong> will reach
        you there.
      </p>
      <p class="body mt-6">
        <TextLink href="/" @click.prevent="emit('leave')">{{ onward }}</TextLink>
      </p>
    </template>
    <template v-else-if="problem">
      <InlineMessage id="confirm-problem" tone="error" class="mt-4" data-testid="confirm-problem">
        {{ problem.code === 'gone' ? goneText : describeProblem(problem) }}
      </InlineMessage>
      <Button v-if="canRetry" class="mt-6" :busy="busy" @click="check">
        {{ busy ? 'Trying again…' : 'Try again' }}
      </Button>
      <p v-else class="body mt-6">
        <TextLink href="/" @click.prevent="emit('leave')">{{ onward }}</TextLink>
      </p>
    </template>
  </AuthCard>
</template>
