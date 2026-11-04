<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, useTemplateRef } from 'vue'
import { Check, Copy, Plus } from '@lucide/vue'
import type { ApiError, ApiResult } from '@/lib/api'
import {
  MAX_TOKEN_NAME,
  MAX_TOKENS,
  connectionFacts,
  createToken,
  listConnections,
  listTokens,
  mcpAddress,
  removeConnection,
  removeToken,
  tokenFacts,
  tokenLabel,
  type Connection,
  type Scope,
  type TokenInfo,
} from '@/lib/connections'
import { useSessionStore } from '@/stores/session'
import { Banner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { InlineMessage } from '@/components/ui/inline-message'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { TextField } from '@/components/ui/text-field'

const ACCESS_OPTIONS = [
  { value: 'read', label: 'Read only' },
  { value: 'write', label: 'Read and change' },
]

const LIST_FAILED = {
  offline:
    'Can’t reach the server, so your apps and tokens can’t be listed. Try again when you’re online.',
  server:
    'The server had a problem, so your apps and tokens can’t be listed. Try again in a while.',
}
const CREATE_FAILED = {
  offline: 'Can’t reach the server, so no token was created. Try again when you’re online.',
  server: 'The server had a problem, so no token was created. Try again in a while.',
  tooMany: `You have ${MAX_TOKENS} tokens, the most there can be. Remove one you don’t use, then create this one.`,
}
const REMOVE_FAILED = {
  offline: 'Can’t reach the server, so nothing was removed. Try again when you’re online.',
  server: 'The server had a problem, so nothing was removed. Try again in a while.',
}
const NO_NAME = 'Give the token a name, like Laptop.'
const BAD_NAME = `Use 1 to ${MAX_TOKEN_NAME} characters, with no line breaks.`
const COPY_FAILED = 'Couldn’t copy. Select the text and copy it yourself.'

/** The new-connection banners dismissed in this tab, by connection id. */
const SEEN_KEY = 'tracker-connections-seen-v1'

const session = useSessionStore()
const address = mcpAddress()
const ids = { apps: useId(), tokens: useId(), name: useId() }
const appsHeading = useTemplateRef<HTMLHeadingElement>('appsHeading')
const tokensHeading = useTemplateRef<HTMLHeadingElement>('tokensHeading')
const shownBox = useTemplateRef<HTMLDivElement>('shownBox')

// ---------------------------------------------------------------- the lists

const tokens = ref<TokenInfo[] | null>(null)
const connections = ref<Connection[] | null>(null)
const listProblem = ref<string | null>(null)
const loading = ref(false)
/** The time the facts are written against ("today", "yesterday"), set when the lists arrive. */
const now = ref(new Date())

function failed(error: ApiError): 'offline' | 'server' {
  return error.kind === 'offline' ? 'offline' : 'server'
}

async function load(): Promise<void> {
  if (loading.value) return
  loading.value = true
  listProblem.value = null
  const [t, c] = await Promise.all([listTokens(session.user), listConnections(session.user)])
  loading.value = false
  now.value = new Date()
  if (t.ok) tokens.value = t.data
  if (c.ok) connections.value = c.data
  const error = !t.ok ? t.error : !c.ok ? c.error : null
  if (error) listProblem.value = LIST_FAILED[failed(error)]
}
onMounted(load)

// ---------------------------------------------------------------- copying

const copied = ref<'address' | 'token' | null>(null)
const copyProblem = ref<string | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

async function copy(text: string, which: 'address' | 'token'): Promise<void> {
  copyProblem.value = null
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    copyProblem.value = COPY_FAILED
    return
  }
  copied.value = which
  clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => (copied.value = null), 2000)
}

// ---------------------------------------------------------------- creating a token

const creating = ref(false)
const newName = ref('')
const newScope = ref<string>('read')
const nameError = ref<string | undefined>(undefined)
const createProblem = ref<string | null>(null)
const createBusy = ref(false)
/** A token just created: shown once, until Done. */
const shown = ref<string | null>(null)

function startCreating(): void {
  shown.value = null
  creating.value = true
  newName.value = ''
  newScope.value = 'read'
  nameError.value = undefined
  createProblem.value = null
}

async function create(): Promise<void> {
  if (createBusy.value) return
  const name = newName.value.trim()
  nameError.value = name ? undefined : NO_NAME
  createProblem.value = null
  if (!name) return
  createBusy.value = true
  const scope: Scope = newScope.value === 'write' ? 'write' : 'read'
  const res = await createToken(session.user, name, scope)
  createBusy.value = false
  if (!res.ok) {
    const e = res.error
    if (e.kind === 'refused' && e.code === 'token-name') nameError.value = BAD_NAME
    else if (e.kind === 'refused' && e.code === 'too-many')
      createProblem.value = CREATE_FAILED.tooMany
    else createProblem.value = CREATE_FAILED[failed(e)]
    return
  }
  now.value = new Date()
  tokens.value = [res.data.info, ...(tokens.value ?? [])]
  creating.value = false
  shown.value = res.data.token
  // The token is read first: it is the one thing to do now.
  await nextTick()
  shownBox.value?.focus()
}

// ---------------------------------------------------------------- the new-connection banner

function readSeen(): string[] {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? '[]')
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}
const seen = ref<string[]>(readSeen())
const fresh = computed(
  () => connections.value?.find((c) => c.isNew && !seen.value.includes(c.id)) ?? null,
)
function dismiss(id: string): void {
  seen.value = [...seen.value, id]
  try {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify(seen.value))
  } catch {
    // Storage refused (a private window): the banner stays away until this page is left.
  }
}

// ---------------------------------------------------------------- removing

type Pending = { kind: 'token'; item: TokenInfo } | { kind: 'app'; item: Connection }
const pending = ref<Pending | null>(null)
const askRemove = ref(false)
const removing = ref(false)
const removeError = ref<string | undefined>(undefined)
/** The row's place in its list, so focus can go to its neighbour once it has gone. */
let removedAt = 0

const removeTitle = computed(() => {
  const p = pending.value
  if (!p) return ''
  return p.kind === 'token' ? `Remove ${p.item.name}?` : `Disconnect ${p.item.clientName}?`
})
const removeMessage = computed(() => {
  const p = pending.value
  if (!p) return ''
  if (p.kind === 'token') {
    return 'Anything using this token stops working at once. You can create a new one.'
  }
  const app = p.item.clientName
  return `${app} can’t reach your tracker any more, from now on. You can connect it again from ${app}.`
})

function ask(p: Pending): void {
  removedAt =
    p.kind === 'token'
      ? (tokens.value?.indexOf(p.item) ?? 0)
      : (connections.value?.indexOf(p.item) ?? 0)
  pending.value = p
  removeError.value = undefined
  askRemove.value = true
}

/** After a removal: the next row's Remove, or the list's heading when none is left. */
function afterRemoval(): HTMLElement | null {
  const kind = pending.value?.kind ?? 'token'
  const list = document.querySelector(
    `[data-testid="${kind === 'token' ? 'tokens' : 'apps'}-list"]`,
  )
  const buttons = [...(list?.querySelectorAll<HTMLElement>('[data-testid="remove"]') ?? [])]
  return (
    buttons[Math.min(removedAt, buttons.length - 1)] ??
    (kind === 'token' ? tokensHeading.value : appsHeading.value)
  )
}

async function confirmRemove(): Promise<void> {
  const p = pending.value
  if (!p || removing.value) return
  removing.value = true
  const res: ApiResult<void> =
    p.kind === 'token'
      ? await removeToken(session.user, p.item.prefix)
      : await removeConnection(session.user, p.item.id)
  removing.value = false
  // Gone already (another tab removed it): the row goes all the same.
  const gone =
    !res.ok &&
    res.error.kind === 'refused' &&
    (res.error.code === 'no-token' || res.error.code === 'no-connection')
  if (!res.ok && !gone) {
    removeError.value = REMOVE_FAILED[failed(res.error)]
    return
  }
  if (p.kind === 'token') tokens.value = tokens.value?.filter((t) => t !== p.item) ?? null
  else connections.value = connections.value?.filter((c) => c !== p.item) ?? null
  askRemove.value = false
}
</script>

<!--
  Settings' Connections row (brand/design-system/project/components/ConnectionsSection, L1): the
  new-connection Banner, the address to give an app with how to connect each one, then the apps
  connected by signing in and the personal tokens, each a row with a line of facts and Remove.
  A new token is shown once. Sizes are the Settings page's (`--set-*`, `u`).
-->
<template>
  <div class="flex min-w-0 flex-col gap-(--set-gap)" data-testid="connections-section">
    <div aria-live="polite">
      <Banner v-if="fresh" class="max-w-[calc(var(--u)*1000)]" data-testid="connection-banner">
        <span class="font-semibold">{{ fresh.clientName }} was connected just now</span>, with
        {{ fresh.scope === 'write' ? 'read and change' : 'read only' }}. If that wasn’t you, remove
        it and change your password.
        <template #action>
          <Button
            class="bg-panel"
            :aria-label="`Remove ${fresh.clientName}`"
            @click="ask({ kind: 'app', item: fresh })"
            >Remove</Button
          >
          <Button class="bg-panel" @click="dismiss(fresh.id)">Dismiss</Button>
        </template>
      </Banner>
    </div>

    <p class="body max-w-[62ch] text-(length:--set-text) leading-[1.45] text-ink-secondary">
      Let Claude or ChatGPT read your weeks and, if you allow it, mark days and edit your plans.
    </p>

    <div class="grid gap-[calc(var(--u)*10)]" data-testid="connect-how">
      <div
        class="flex max-w-[calc(var(--u)*820)] flex-wrap items-center gap-[calc(var(--u)*12)] rounded-md border border-line bg-tile py-[calc(var(--u)*6)] pr-[calc(var(--u)*6)] pl-[calc(var(--u)*16)]"
        data-testid="mcp-address-tile"
      >
        <code
          class="min-w-0 flex-[1_1_240px] font-mono text-[calc(var(--set-label)*0.95)] wrap-anywhere text-ink"
          data-testid="mcp-address"
          >{{ address }}</code
        >
        <Button
          class="ml-auto bg-panel hover:not-disabled:bg-canvas"
          @click="copy(address, 'address')"
        >
          <component :is="copied === 'address' ? Check : Copy" :stroke-width="1.5" />{{
            copied === 'address' ? 'Copied' : 'Copy'
          }}
        </Button>
      </div>
      <p
        class="max-w-[70ch] text-(length:--set-label) leading-normal text-ink-secondary [&_b]:font-semibold [&_b]:text-ink"
      >
        <b>Claude (claude.ai, desktop and phone):</b> in Claude’s Settings › Connectors, choose Add
        custom connector and paste this address. Claude opens this page to ask for your password.
      </p>
      <p
        class="max-w-[70ch] text-(length:--set-label) leading-normal text-ink-secondary [&_b]:font-semibold [&_b]:text-ink"
      >
        <b>Claude Code:</b> run
        <code class="font-mono text-[0.9em]"
          >claude mcp add --transport http tracker {{ address }}</code
        >, then <code class="font-mono text-[0.9em]">/mcp</code> to sign in. Or use a token below.
      </p>
      <p
        class="max-w-[70ch] text-(length:--set-label) leading-normal text-ink-secondary [&_b]:font-semibold [&_b]:text-ink"
      >
        <b>ChatGPT (on the web):</b> in ChatGPT’s Plugins, choose + then Add custom MCP server,
        paste this address and choose OAuth. ChatGPT opens this page to ask for your password.
      </p>
    </div>
    <span aria-live="polite" class="sr-only" data-testid="copy-status">{{
      copied ? 'Copied.' : ''
    }}</span>
    <InlineMessage v-if="copyProblem" tone="error" data-testid="copy-problem">
      {{ copyProblem }}
    </InlineMessage>

    <InlineMessage v-if="listProblem" tone="error" data-testid="connections-problem">
      {{ listProblem }}
    </InlineMessage>
    <div v-if="listProblem">
      <Button :busy="loading" @click="load">{{ loading ? 'Trying again…' : 'Try again' }}</Button>
    </div>

    <div class="flex flex-col gap-[calc(var(--u)*12)]">
      <h3
        :id="ids.apps"
        ref="appsHeading"
        tabindex="-1"
        class="text-(length:--set-label) leading-[1.3] font-semibold text-ink focus:outline-none"
      >
        Apps
      </h3>
      <p class="max-w-[62ch] text-(length:--set-text) leading-[1.45] text-ink-secondary">
        Connected by signing in from Claude or ChatGPT. Each lasts 90 days.
      </p>
      <template v-if="connections">
        <ul
          v-if="connections.length"
          :aria-labelledby="ids.apps"
          class="max-w-[calc(var(--u)*1000)]"
          data-testid="apps-list"
        >
          <li
            v-for="c in connections"
            :key="c.id"
            class="flex flex-wrap items-center justify-between gap-x-[calc(var(--u)*16)] gap-y-[calc(var(--u)*8)] border-t border-line py-[calc(var(--u)*14)] last:border-b"
            data-testid="app-row"
            :data-id="c.id"
          >
            <div
              class="grid min-w-0 flex-[1_1_calc(var(--u)*420)] gap-[calc(var(--u)*4)] folded:basis-full"
            >
              <span
                data-slot="connection-name"
                class="text-(length:--set-text) leading-[1.3] font-semibold text-ink"
                >{{ c.clientName }}
                <span class="font-normal text-ink-secondary">· {{ c.clientHost }}</span></span
              >
              <span
                data-slot="connection-facts"
                class="text-(length:--set-label) leading-[1.4] text-ink-secondary"
                ><template v-if="c.isNew"
                  ><span class="font-semibold text-ink">New</span> · </template
                >{{ connectionFacts({ ...c, isNew: false }, now) }}</span
              >
            </div>
            <Button
              :aria-label="`Remove ${c.clientName}`"
              data-testid="remove"
              @click="ask({ kind: 'app', item: c })"
              >Remove</Button
            >
          </li>
        </ul>
        <p v-else class="max-w-[62ch] text-(length:--set-text) leading-[1.45] text-ink-secondary">
          No apps are connected.
        </p>
      </template>
    </div>

    <div class="mt-[calc(var(--u)*8)] flex flex-col gap-[calc(var(--u)*12)]">
      <h3
        :id="ids.tokens"
        ref="tokensHeading"
        tabindex="-1"
        class="text-(length:--set-label) leading-[1.3] font-semibold text-ink focus:outline-none"
      >
        Tokens
      </h3>
      <p class="max-w-[62ch] text-(length:--set-text) leading-[1.45] text-ink-secondary">
        For Claude Code, Claude Desktop and scripts. A token works until you remove it.
      </p>

      <div
        v-if="shown"
        ref="shownBox"
        tabindex="-1"
        class="grid max-w-[calc(var(--u)*820)] gap-[calc(var(--u)*12)] focus:outline-none"
        data-testid="token-shown"
      >
        <p class="text-(length:--set-text) leading-[1.4] font-semibold text-ink">
          Copy your new token now. It won’t be shown again.
        </p>
        <div
          class="flex flex-wrap items-center gap-[calc(var(--u)*12)] rounded-md border border-line bg-tile py-[calc(var(--u)*6)] pr-[calc(var(--u)*6)] pl-[calc(var(--u)*16)]"
        >
          <code
            class="min-w-0 flex-[1_1_240px] font-mono text-[calc(var(--set-label)*0.95)] wrap-anywhere text-ink"
            data-testid="token-plain"
            >{{ shown }}</code
          >
          <Button
            class="ml-auto bg-panel hover:not-disabled:bg-canvas"
            @click="copy(shown, 'token')"
          >
            <component :is="copied === 'token' ? Check : Copy" :stroke-width="1.5" />{{
              copied === 'token' ? 'Copied' : 'Copy'
            }}
          </Button>
        </div>
        <p class="max-w-[62ch] text-(length:--set-text) leading-[1.45] text-ink-secondary">
          Give it to the app as a header:
          <code class="font-mono text-[0.9em]"
            >Authorization: Bearer {{ shown.slice(0, 12) }}…</code
          >
        </p>
        <div class="flex flex-wrap gap-[calc(var(--u)*12)]">
          <Button data-testid="token-done" @click="shown = null">Done</Button>
        </div>
      </div>

      <template v-if="tokens">
        <ul
          v-if="tokens.length"
          :aria-labelledby="ids.tokens"
          class="max-w-[calc(var(--u)*1000)]"
          data-testid="tokens-list"
        >
          <li
            v-for="t in tokens"
            :key="t.prefix"
            class="flex flex-wrap items-center justify-between gap-x-[calc(var(--u)*16)] gap-y-[calc(var(--u)*8)] border-t border-line py-[calc(var(--u)*14)] last:border-b"
            data-testid="token-row"
            :data-prefix="t.prefix"
          >
            <div
              class="grid min-w-0 flex-[1_1_calc(var(--u)*420)] gap-[calc(var(--u)*4)] folded:basis-full"
            >
              <span
                data-slot="connection-name"
                class="text-(length:--set-text) leading-[1.3] font-semibold wrap-anywhere text-ink"
                >{{ t.name }}</span
              >
              <span
                data-slot="connection-facts"
                class="text-(length:--set-label) leading-[1.4] text-ink-secondary"
                ><span class="font-mono text-[0.9em]">{{ tokenLabel(t.prefix) }}</span> ·
                {{ tokenFacts(t, now) }}</span
              >
            </div>
            <Button
              :aria-label="`Remove ${t.name}`"
              data-testid="remove"
              @click="ask({ kind: 'token', item: t })"
              >Remove</Button
            >
          </li>
        </ul>
        <p v-else class="max-w-[62ch] text-(length:--set-text) leading-[1.45] text-ink-secondary">
          No tokens yet.
        </p>
      </template>

      <form
        v-if="creating"
        class="flex flex-wrap items-end gap-x-[calc(var(--u)*16)] gap-y-[calc(var(--u)*12)]"
        data-testid="token-form"
        novalidate
        @submit.prevent="create"
      >
        <TextField
          :id="ids.name"
          v-model="newName"
          label="Name"
          :maxlength="MAX_TOKEN_NAME"
          autocomplete="off"
          :error="nameError"
          class="w-[calc(var(--u)*300)] max-w-full folded:w-full"
          data-testid="token-name"
        />
        <SegmentedControl v-model="newScope" label="Access" :options="ACCESS_OPTIONS" />
        <div class="flex flex-wrap gap-[calc(var(--u)*12)]">
          <Button @click="creating = false">Cancel</Button>
          <Button type="submit" variant="primary" :busy="createBusy">
            {{ createBusy ? 'Creating token…' : 'Create token' }}
          </Button>
        </div>
      </form>
      <InlineMessage v-if="creating && createProblem" tone="error" data-testid="token-problem">
        {{ createProblem }}
      </InlineMessage>
      <div v-if="!creating && !shown" class="flex flex-wrap gap-[calc(var(--u)*12)]">
        <Button data-testid="create-token" @click="startCreating"
          ><Plus :stroke-width="1.5" />Create token</Button
        >
      </div>
    </div>

    <ConfirmDialog
      v-model:open="askRemove"
      :title="removeTitle"
      :message="removeMessage"
      :confirm-label="pending?.kind === 'app' ? 'Disconnect' : 'Remove'"
      :busy="removing"
      :error="removeError"
      :return-focus="afterRemoval"
      @confirm="confirmRemove"
    />
  </div>
</template>
