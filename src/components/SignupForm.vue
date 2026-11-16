<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useSessionStore, type AuthProblem } from '@/stores/session'
import { MISMATCH, describeProblem } from '@/lib/problems'
import AuthCard from '@/components/AuthCard.vue'
import { Button } from '@/components/ui/button'
import { InlineMessage } from '@/components/ui/inline-message'
import { TextField } from '@/components/ui/text-field'
import { TextLink } from '@/components/ui/text-link'

const emit = defineEmits<{
  /** The person left for the sign-in screen. */
  leave: []
}>()

const MIN = 10
const session = useSessionStore()
const email = ref('')
const password = ref('')
const confirm = ref('')
const busy = ref(false)
const mismatch = ref(false)
const problem = ref<AuthProblem | null>(null)

// The server's refusals of the email and the password belong to those fields; anything else goes
// above the button.
const FIELD = { email: 'signup-email', exists: 'signup-email', password: 'signup-password' }
type FieldCode = keyof typeof FIELD
function fieldOf(p: AuthProblem | null): string | undefined {
  return p && p.code in FIELD ? FIELD[p.code as FieldCode] : undefined
}
const emailError = computed(() =>
  fieldOf(problem.value) === 'signup-email' ? describeProblem(problem.value!) : undefined,
)
const passwordError = computed(() =>
  fieldOf(problem.value) === 'signup-password' ? describeProblem(problem.value!) : undefined,
)
const formProblem = computed(() =>
  problem.value && !fieldOf(problem.value) ? describeProblem(problem.value) : null,
)

// A field's error stays until its value changes.
watch(email, () => {
  if (emailError.value) problem.value = null
})
watch([password, confirm], () => {
  mismatch.value = false
  if (passwordError.value) problem.value = null
})

async function focus(id: string): Promise<void> {
  await nextTick()
  const input = document.getElementById(id) as HTMLInputElement | null
  input?.focus()
  input?.select()
}

async function submit(): Promise<void> {
  mismatch.value = password.value !== confirm.value
  if (mismatch.value) return focus('signup-confirm')
  if (busy.value) return
  busy.value = true
  problem.value = await session.signup(email.value.trim(), password.value)
  busy.value = false
  const field = fieldOf(problem.value)
  if (field) await focus(field)
}
</script>

<template>
  <AuthCard title="Create an account">
    <p class="body mb-6 text-ink-secondary">Keep your plans and mark days on any device.</p>
    <form class="flex flex-col gap-4" @submit.prevent="submit">
      <!-- `username` rather than `email`, so password managers save the new password against it:
           the email is the name this account signs in with. -->
      <TextField
        id="signup-email"
        v-model="email"
        label="Email"
        type="email"
        autocomplete="username"
        autocapitalize="none"
        spellcheck="false"
        maxlength="254"
        required
        :error="emailError"
      />
      <TextField
        id="signup-password"
        v-model="password"
        label="Password"
        type="password"
        autocomplete="new-password"
        :minlength="MIN"
        maxlength="256"
        required
        :hint="`At least ${MIN} characters.`"
        :error="passwordError"
      />
      <TextField
        id="signup-confirm"
        v-model="confirm"
        label="Repeat password"
        type="password"
        autocomplete="new-password"
        required
        :error="mismatch ? MISMATCH : undefined"
      />
      <InlineMessage
        v-if="formProblem"
        id="signup-problem"
        tone="error"
        data-testid="signup-problem"
      >
        {{ formProblem }}
      </InlineMessage>
      <Button type="submit" variant="primary" class="mt-2" :busy="busy">
        {{ busy ? 'Creating account…' : 'Create account' }}
      </Button>
    </form>
    <p class="body mt-6">
      <TextLink href="/" @click.prevent="emit('leave')">Go to sign in</TextLink>
    </p>
  </AuthCard>
</template>
