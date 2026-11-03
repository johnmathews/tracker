<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { ApiError } from '@/lib/api'
import {
  approveRequest,
  backTo,
  denyRequest,
  getRequest,
  navigateTo,
  type ConsentRequest,
  type Scope,
} from '@/lib/connections'
import { describeConnectProblem, type ConnectProblem } from '@/lib/problems'
import { useSessionStore } from '@/stores/session'
import AuthCard from '@/components/AuthCard.vue'
import { Button } from '@/components/ui/button'
import { InlineMessage } from '@/components/ui/inline-message'
import { RadioCard } from '@/components/ui/radio-card'
import { TextField } from '@/components/ui/text-field'
import { TextLink } from '@/components/ui/text-link'

const props = defineProps<{ requestId: string }>()
const emit = defineEmits<{
  /** The request was used, refused or is dead, so its id can leave the address bar. */
  spent: []
  /** The person left for the week, or for sign-in. */
  leave: []
}>()

const session = useSessionStore()
const request = ref<ConsentRequest | null>(null)
const phase = ref<'loading' | 'ready' | 'expired' | 'failed'>('loading')
const loadProblem = ref<ConnectProblem | null>(null)
const retrying = ref(false)

const email = ref(session.user ?? '')
const password = ref('')
// Read only every time the screen opens, whatever the app asked for (D4, C2).
const access = ref<Scope>('read')
const busy = ref<'approve' | 'deny' | null>(null)
const problem = ref<ConnectProblem | null>(null)

const signedIn = computed(() => session.status === 'signed-in')
// The session may be confirmed after the screen opens: fill the email then, if still empty.
watch(
  () => session.user,
  (user) => {
    if (user && !email.value) email.value = user
  },
)

const app = computed(() => request.value?.clientName ?? 'the app')
const title = computed(() => {
  if (phase.value === 'ready') return `Connect ${app.value}`
  if (phase.value === 'expired') return 'This link has expired'
  if (phase.value === 'failed') return 'Couldn’t check the link'
  return 'Checking the link…'
})
const options = computed(() => [
  { value: 'read', label: 'Read only', hint: 'See your plans, marks and notes.' },
  { value: 'write', label: 'Read and change', hint: 'Also mark days, and add and edit items.' },
])
const accessModel = computed({
  get: () => access.value,
  set: (v: string) => (access.value = v === 'write' ? 'write' : 'read'),
})
// One message covers both fields: the server doesn't say which of the two was wrong.
const wrong = computed(() => problem.value?.code === 'invalid')
const describedBy = computed(() => (problem.value ? 'connect-problem' : undefined))
const onward = computed(() => (signedIn.value ? 'Go to the week' : 'Go to sign in'))

const KNOWN = ['invalid', 'locked', 'busy', 'too-many', 'no-request', 'disabled'] as const

function problemFor(error: ApiError): ConnectProblem {
  if (error.kind === 'offline') return { code: 'offline' }
  if (error.kind !== 'refused') return { code: 'error' }
  const code = KNOWN.find((c) => c === error.code) ?? 'error'
  return error.retryAfter === undefined ? { code } : { code, retryAfter: error.retryAfter }
}

function expire(): void {
  phase.value = 'expired'
  emit('spent')
}

async function load(): Promise<void> {
  retrying.value = phase.value === 'failed'
  const res = await getRequest(props.requestId)
  retrying.value = false
  if (res.ok) {
    request.value = res.data
    phase.value = 'ready'
    return
  }
  const p = problemFor(res.error)
  if (p.code === 'no-request') return expire()
  loadProblem.value = p
  phase.value = 'failed'
}

/** The API answered with the address to go back to: leave for it, the screen's work done. */
function leaveFor(url: string): void {
  emit('spent')
  navigateTo(url)
}

async function refused(error: ApiError): Promise<void> {
  busy.value = null
  const p = problemFor(error)
  if (p.code === 'no-request') return expire()
  problem.value = p
  if (p.code !== 'invalid') return
  // Back to the password, ready for another try; the error is announced by its role.
  await nextTick()
  const input = document.getElementById('connect-password') as HTMLInputElement | null
  input?.focus()
  input?.select()
}

async function approve(): Promise<void> {
  if (busy.value) return
  busy.value = 'approve'
  problem.value = null
  const res = await approveRequest(props.requestId, {
    email: email.value.trim(),
    password: password.value,
    write: access.value === 'write',
  })
  // Busy stays on while the browser leaves.
  if (res.ok) leaveFor(res.data)
  else await refused(res.error)
}

async function deny(): Promise<void> {
  if (busy.value) return
  busy.value = 'deny'
  problem.value = null
  const res = await denyRequest(props.requestId)
  if (res.ok) leaveFor(res.data)
  else await refused(res.error)
}

onMounted(load)
</script>

<!--
  The connect screen (brand/design-system/project/components/ConnectPage, C2): the sign-in card,
  with the warning first, who is asking and where it goes back to, the email and password (even
  when signed in), what the app may do (Read only chosen), then Cancel and Connect. A link route
  (App.vue): it shows signed in or out, and a sign-out elsewhere doesn't drop it (F10).
-->
<template>
  <AuthCard :title="title" data-testid="connect-page">
    <template v-if="phase === 'ready' && request">
      <InlineMessage tone="caution" data-testid="connect-warning">
        Only continue if you just asked {{ app }} to connect to your tracker. If you didn’t, choose
        Cancel.
      </InlineMessage>
      <form class="mt-4 flex flex-col gap-4" @submit.prevent="approve">
        <dl
          class="body m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 border-y border-line py-3"
          data-testid="connect-who"
        >
          <dt class="text-ink-secondary">Asking</dt>
          <dd class="m-0 font-semibold wrap-anywhere">
            {{ request.clientName }}, from {{ request.clientHost }}
          </dd>
          <dt class="text-ink-secondary">Then back to</dt>
          <dd class="m-0 font-semibold wrap-anywhere">{{ backTo(request.redirectHost) }}</dd>
        </dl>
        <!-- inputmode, not type="email": an account from before invites signs in with its name. -->
        <TextField
          id="connect-email"
          v-model="email"
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
          id="connect-password"
          v-model="password"
          label="Password"
          type="password"
          autocomplete="current-password"
          required
          :hint="
            signedIn
              ? 'You’re signed in, but connecting an app asks for your password again.'
              : undefined
          "
          :invalid="wrong"
          :aria-describedby="describedBy"
        />
        <InlineMessage
          v-if="problem"
          id="connect-problem"
          tone="error"
          data-testid="connect-problem"
        >
          {{ describeConnectProblem(problem) }}
        </InlineMessage>
        <RadioCard
          v-model="accessModel"
          :label="`What ${app} can do`"
          :options="options"
          data-testid="connect-access"
        />
        <div class="mt-2 flex gap-3">
          <Button class="flex-1" :busy="busy === 'deny'" data-testid="connect-cancel" @click="deny">
            {{ busy === 'deny' ? 'Cancelling…' : 'Cancel' }}
          </Button>
          <Button
            type="submit"
            variant="primary"
            class="flex-1"
            :busy="busy === 'approve'"
            data-testid="connect-approve"
          >
            {{ busy === 'approve' ? 'Connecting…' : 'Connect' }}
          </Button>
        </div>
      </form>
      <p class="caption mt-4 text-ink-secondary" data-testid="connect-footnote">
        The connection lasts 90 days. You can remove it sooner in Settings › Connections.
      </p>
    </template>
    <template v-else-if="phase === 'expired'">
      <p class="body text-ink-secondary" data-testid="connect-expired">
        It was already used, or it’s more than ten minutes old. Go back to the app and connect
        again.
      </p>
      <p class="body mt-6">
        <TextLink href="/" @click.prevent="emit('leave')">{{ onward }}</TextLink>
      </p>
    </template>
    <template v-else-if="phase === 'failed' && loadProblem">
      <InlineMessage tone="error" class="mt-4" data-testid="connect-load-problem">
        {{ describeConnectProblem(loadProblem) }}
      </InlineMessage>
      <Button class="mt-6" :busy="retrying" @click="load">
        {{ retrying ? 'Trying again…' : 'Try again' }}
      </Button>
    </template>
  </AuthCard>
</template>
