<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, useId, useTemplateRef } from 'vue'
import { ChevronLeft, X } from '@lucide/vue'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { Button } from '@/components/ui/button'
import { dialogPanelVariants, scrimVariants } from '@/components/ui/dialog'
import { IconButton } from '@/components/ui/icon-button'
import { InlineMessage } from '@/components/ui/inline-message'
import { TextField } from '@/components/ui/text-field'
import { dayText, sentenceCase, type Outcome, type Problem, type Run } from '@/lib/programmes'
import {
  previewWords,
  type Confirmed,
  type RunAction,
  type RunActionBody,
  type RunActionPreview,
} from '@/lib/runActions'

const props = defineProps<{
  /** The run it acts on: its today, weeks and end come from the server. */
  run: Run
  /** Re-open programme, Restart from week 1, or Cancel the end (K168). */
  action: RunAction
  /** The tracker's name: the title's, and Restart's Name to start with. */
  name: string
  /** Sends the action as a preview (P2): the server writes nothing. */
  preview: (body: RunActionBody) => Promise<Outcome<RunActionPreview>>
  /** Applies the action with the preview's rev. */
  confirm: (body: RunActionBody, rev: string) => Promise<Confirmed<unknown, RunActionPreview>>
}>()

const emit = defineEmits<{
  /** The action is made: what the server sent back (the run, or the new tracker and run). */
  done: [data: unknown]
}>()

const open = defineModel<boolean>('open', { required: true })

const ids = { list: useId() }

/** Cancel the end has one step: its day can only be the end's own (K168). */
const oneStep = props.action === 'cancel-end'
const form = reactive({
  from: props.run.today,
  reason: '',
  name: props.name,
  start: props.run.today,
})
const step = ref<1 | 2>(oneStep ? 2 : 1)
/** The server's preview, shown on step 2. */
const shown = ref<RunActionPreview | null>(null)
/** The run changed since the preview: the fresh one shows, with a line saying so. */
const stale = ref(false)
const busy = ref<'preview' | 'confirm' | null>(null)
/** The server's problems by field, and the rest, or why a request failed, as lines. */
const errors = reactive<Record<string, string>>({})
const general = ref<string[]>([])
/** The body the shown preview is of: the confirm sends it again, with the preview's rev. */
let previewed: RunActionBody | null = null

const title = computed(
  () =>
    ({
      reopen: `Re-open ${props.name}`,
      restart: `Restart ${props.name}`,
      'cancel-end': `Cancel the end of ${props.name}`,
    })[props.action],
)
const confirmLabel = computed(
  () =>
    ({
      reopen: 'Re-open programme',
      restart: 'Restart programme',
      'cancel-end': 'Cancel the end',
    })[props.action],
)
const dayHint = computed(() => `Today, ${dayText(props.run.today)}, or any later day.`)
const words = computed(() =>
  shown.value ? previewWords(props.action, shown.value, props.run) : null,
)

/** The body step 1 sends: the day and the reason, or the name and the start. */
function body(): RunActionBody {
  if (props.action === 'cancel-end') return { from: props.run.ended!.from }
  if (props.action === 'restart') return { name: form.name, start: form.start }
  const reason = form.reason.trim()
  return reason ? { from: form.from, reason } : { from: form.from }
}

/** The fields the server can name in a problem; anything else goes over the actions. */
const FIELDS = ['from', 'reason', 'name', 'start']

function show(problems: Problem[], message: string | null): void {
  for (const key of Object.keys(errors)) delete errors[key]
  general.value = message ? [message] : []
  for (const p of problems) {
    if (FIELDS.includes(p.path) && !errors[p.path] && !oneStep)
      errors[p.path] = sentenceCase(p.message)
    else general.value.push(sentenceCase(p.message))
  }
}

const root = useTemplateRef<HTMLElement>('root')
/** Focus the first of `selectors` the sheet has. */
async function focus(...selectors: string[]): Promise<void> {
  await nextTick()
  for (const selector of selectors) {
    const el = root.value?.querySelector<HTMLElement>(selector)
    if (el) return el.focus()
  }
}

/** Preview: the server says what the action does; nothing is written (P2). */
async function previewAction(): Promise<void> {
  if (busy.value) return
  busy.value = 'preview'
  const sent = body()
  const res = await props.preview(sent)
  busy.value = null
  if (!res.ok) {
    show(res.problems, res.message)
    return
  }
  show([], null)
  previewed = sent
  shown.value = res.data
  stale.value = false
  step.value = 2
  await focus('[data-testid="run-summary"]')
}

/** The confirm: the action with the preview's rev. A stale rev shows the fresh preview. */
async function confirmAction(): Promise<void> {
  if (busy.value || !shown.value || !previewed) return
  busy.value = 'confirm'
  const res = await props.confirm(previewed, shown.value.rev)
  busy.value = null
  if (res.ok) {
    emit('done', res.data)
    open.value = false
    return
  }
  if ('stale' in res) {
    show([], null)
    shown.value = res.stale
    stale.value = true
    await focus('[data-testid="run-summary"]')
    return
  }
  show(res.problems, res.message)
}

async function back(): Promise<void> {
  step.value = 1
  await focus('[data-testid="run-from"]', '[data-testid="run-name"]')
}

// Cancel the end asks for its preview as it opens: there is nothing to fill in first.
onMounted(() => {
  if (oneStep) void previewAction()
})

/** On open, focus goes to the first field, or to Keep the end while the preview comes. */
function onOpenAutoFocus(event: Event): void {
  event.preventDefault()
  void focus(
    '[data-testid="run-from"]',
    '[data-testid="run-name"]',
    '[data-testid="run-summary"]',
    '[data-testid="run-keep"]',
  )
}

const LABEL = 'label text-(length:--set-label) leading-[1.3] text-ink'
const HINT = 'caption text-(length:--set-caption) leading-[1.35] text-ink-secondary'
const TWO =
  'grid grid-cols-[repeat(auto-fill,minmax(min(100%,calc(var(--u)*260)),1fr))] items-start gap-x-6 gap-y-5'
</script>

<!--
  The ChangeSheet card's run sheet (brand/design-system/project/components/ChangeSheet, K168):
  Re-open programme, Restart from week 1 or Cancel the end, on the ChangeSheet's look. Re-open and
  Restart have two steps: the day and the reason, or the name and the start, then what the server
  says it does, a "What it does" list, and the confirm. Cancel the end is one step, the re-open's
  preview from the end's own day, with Keep the end and Cancel the end. Nothing is written until
  the confirm (P2), which sends the preview's rev; a stale rev brings the fresh preview with a line
  saying so. Closing at either step changes nothing.
-->
<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay data-slot="dialog-scrim" :class="scrimVariants()" />
      <DialogContent
        data-slot="dialog"
        aria-modal="true"
        :class="dialogPanelVariants({ size: 'md' })"
        data-testid="run-sheet"
        :data-action="action"
        :data-step="step"
        @open-auto-focus="onOpenAutoFocus"
      >
        <div ref="root" class="flex flex-col gap-[max(16px,calc(var(--u)*20))]">
          <div>
            <DialogDescription
              v-if="!oneStep"
              as="p"
              class="label text-(length:--set-caption) leading-[1.35] text-ink-secondary"
              data-testid="run-step"
              >Step {{ step }} of 2</DialogDescription
            >
            <DialogDescription v-else as="p" class="sr-only"
              >Nothing changes until you cancel the end.</DialogDescription
            >
            <div class="flex items-start justify-between gap-2">
              <DialogTitle
                as="h2"
                class="title-2 pt-2 text-(length:--set-h2) leading-tight text-ink"
                >{{ title }}</DialogTitle
              >
              <DialogClose as-child>
                <IconButton
                  label="Close"
                  class="-mr-2 size-(--edit-ib) [&_svg]:size-(--edit-ib-icon)"
                  data-testid="run-close"
                  ><X
                /></IconButton>
              </DialogClose>
            </div>
          </div>

          <template v-if="step === 1">
            <div v-if="action === 'reopen'" class="flex flex-col gap-5">
              <div :class="TWO">
                <TextField
                  v-model="form.from"
                  type="date"
                  label="From"
                  :min="run.today"
                  :hint="dayHint"
                  :error="errors.from"
                  data-testid="run-from"
                />
              </div>
              <TextField
                v-model="form.reason"
                label="Reason"
                hint="It shows in Changes."
                :error="errors.reason"
                autocomplete="off"
                data-testid="run-reason"
              />
            </div>
            <div v-else :class="TWO">
              <TextField
                v-model="form.name"
                label="Name"
                hint="The new tracker’s name."
                :error="errors.name"
                autocomplete="off"
                data-testid="run-name"
              />
              <TextField
                v-model="form.start"
                type="date"
                label="Starts"
                :min="run.today"
                :hint="dayHint"
                :error="errors.start"
                data-testid="run-start"
              />
            </div>
          </template>

          <template v-else-if="words">
            <p
              tabindex="-1"
              class="rounded-sm bg-tile px-3.5 py-3 text-(length:--set-text) leading-[1.45] text-ink focus:outline-none focus-visible:outline-2"
              data-testid="run-summary"
            >
              {{ words.summary }}<i v-if="words.reason" class="note">{{ ` ${words.reason}` }}</i>
            </p>
            <section
              :aria-labelledby="ids.list"
              class="flex flex-col gap-2 border-t border-line pt-5"
            >
              <h3 :id="ids.list" :class="LABEL">What it does</h3>
              <ol class="flex flex-col" data-testid="run-preview">
                <li
                  v-for="row in words.rows"
                  :key="row.name"
                  class="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 border-b border-line py-2.5 text-(length:--set-text) leading-[1.4] first:border-t"
                  data-testid="run-preview-row"
                >
                  <span class="font-semibold"
                    ><span data-part="name">{{ row.name }}</span
                    ><span :class="HINT" class="block font-normal" data-part="hint">{{
                      row.hint
                    }}</span></span
                  >
                  <span class="font-semibold whitespace-nowrap" data-part="value">{{
                    row.value
                  }}</span>
                </li>
              </ol>
              <p :class="HINT" data-testid="run-unchanged">{{ words.calm }}</p>
            </section>
            <InlineMessage v-if="stale" tone="info" data-testid="run-stale"
              >The plan changed since this preview. Check it, then confirm.</InlineMessage
            >
          </template>

          <div v-if="general.length" class="flex flex-col gap-1" data-testid="run-error">
            <InlineMessage v-for="line in general" :key="line" tone="error">{{
              line
            }}</InlineMessage>
          </div>

          <div class="flex flex-wrap justify-end gap-3 pt-1 folded:[&>*]:flex-1">
            <template v-if="step === 1">
              <Button data-testid="run-cancel" @click="open = false">Cancel</Button>
              <Button
                variant="primary"
                :busy="busy === 'preview'"
                data-testid="run-preview-button"
                @click="previewAction"
                >Preview</Button
              >
            </template>
            <template v-else>
              <Button v-if="oneStep" data-testid="run-keep" @click="open = false"
                >Keep the end</Button
              >
              <Button v-else data-testid="run-back" @click="back"
                ><ChevronLeft :stroke-width="1.5" />Back</Button
              >
              <Button
                variant="primary"
                :busy="busy !== null"
                :disabled="!shown"
                data-testid="run-confirm"
                @click="confirmAction"
                >{{ confirmLabel }}</Button
              >
            </template>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
