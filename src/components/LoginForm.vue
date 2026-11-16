<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useSessionStore, type AuthProblem } from '@/stores/session'
import { describeProblem } from '@/lib/problems'
import AuthCard from '@/components/AuthCard.vue'
import { Button } from '@/components/ui/button'
import { InlineMessage } from '@/components/ui/inline-message'
import { TextField } from '@/components/ui/text-field'
import { TextLink } from '@/components/ui/text-link'

const session = useSessionStore()
const username = ref(session.user ?? '')
const password = ref('')
const busy = ref(false)
const problem = ref<AuthProblem | null>(null)

const intro = computed(() =>
  session.expired
    ? 'Your session has ended. Sign in again to keep syncing. Your changes on this device are kept.'
    : 'Sign in to see your plans and mark days on any device.',
)
// One message covers both fields: the server doesn't say which of the two was wrong.
const wrong = computed(() => problem.value?.code === 'invalid')
const describedBy = computed(() => (problem.value ? 'login-problem' : undefined))

// "Forgot your password?" only where the planner sends email; otherwise a reset is tracker-admin's.
onMounted(() => void session.loadOptions())

async function submit(): Promise<void> {
  if (busy.value) return
  busy.value = true
  problem.value = await session.login(username.value.trim(), password.value)
  busy.value = false
  if (!problem.value) {
    password.value = ''
    return
  }
  // Back to the password, ready for another try; the error is announced by its role.
  await nextTick()
  const input = document.getElementById('login-password') as HTMLInputElement | null
  input?.focus()
  input?.select()
}
</script>

<template>
  <AuthCard title="Sign in">
    <p class="body mb-6 text-ink-secondary">{{ intro }}</p>
    <form class="flex flex-col gap-4" @submit.prevent="submit">
      <!-- inputmode, not type="email": an account from before invites took an email still signs
           in with its username, which the browser would refuse in an email field. -->
      <TextField
        id="login-username"
        v-model="username"
        label="Email"
        inputmode="email"
        autocomplete="username"
        autocapitalize="none"
        spellcheck="false"
        required
        :invalid="wrong"
        :aria-describedby="describedBy"
      />
      <TextField
        id="login-password"
        v-model="password"
        label="Password"
        type="password"
        autocomplete="current-password"
        required
        :invalid="wrong"
        :aria-describedby="describedBy"
      />
      <InlineMessage v-if="problem" id="login-problem" tone="error" data-testid="login-problem">
        {{ describeProblem(problem) }}
      </InlineMessage>
      <Button type="submit" variant="primary" class="mt-2" :busy="busy">
        {{ busy ? 'Signing in…' : 'Sign in' }}
      </Button>
    </form>
    <p v-if="session.mail" class="body mt-4">
      <TextLink href="#/forgot">Forgot your password?</TextLink>
    </p>
    <p class="body mt-6 text-ink-secondary">
      New here? <TextLink href="#/signup">Create an account</TextLink>
    </p>
  </AuthCard>
</template>
