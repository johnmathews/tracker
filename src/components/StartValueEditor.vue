<script setup lang="ts">
import { computed, nextTick, reactive, ref, shallowRef, useId, useTemplateRef, watch } from 'vue'
import { ChevronDown, ChevronRight, CircleAlert, Pencil, Trash2 } from '@lucide/vue'
import {
  paramUses,
  removeParam,
  renameParam,
  setParamField,
  setParamKey,
  type DraftSession,
  type Param,
  type ProgrammeDoc,
} from '@/lib/programmeDraft'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { InlineMessage } from '@/components/ui/inline-message'
import { TextField } from '@/components/ui/text-field'
import { textLinkVariants } from '@/components/ui/text-link'

/** A problem inside the value: `fieldId` is its path past the value (`default`, `min`), or null. */
export type ParamProblem = { fieldId: string | null; message: string }

const props = defineProps<{
  /** The draft: the editor reads and writes its value there (spec F1). */
  doc: ProgrammeDoc
  /** Which keys follow their labels (spec F5). */
  session: DraftSession
  /** The value's key in `params`. */
  paramKey: string
  open: boolean
  problems: ParamProblem[]
}>()

const emit = defineEmits<{
  /** The pencil or the head was pressed: open the value, or close it. */
  toggle: []
  /** Remove took the value out of the draft. */
  removed: []
}>()

const id = useId()
const ids = {
  body: `${id}-body`,
  problem: `${id}-problem`,
  more: `${id}-more`,
  refused: `${id}-refused`,
}

/**
 * The value's object. It stays the same through a new label or key, so the editor follows it: its
 * key is wherever the object is now, even before the page passes the new one.
 */
const param = shallowRef<Param>(props.doc.params![props.paramKey]!)
/** Where the value is now; once removed, the key it was opened with. */
const key = computed(
  () =>
    Object.entries(props.doc.params ?? {}).find(([, p]) => p === param.value)?.[0] ??
    props.paramKey,
)

// -- words --

function listText(items: string[]): string {
  if (items.length < 2) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}
/** A number in the value's unit: "40 kg", "5%", "8". */
function amount(n: number): string {
  const unit = param.value.unit
  return unit === '%' ? `${n}%` : `${n} ${unit}`.trim()
}
const name = computed(() => param.value.label || 'No label yet')
const defaultWords = computed(() => `${amount(param.value.default)} by default`)
/** The head's line: "40 kg by default, from 20 to 200 kg". */
const summary = computed(() => {
  const { min, max } = param.value
  if (min !== undefined && max !== undefined) {
    return `${defaultWords.value}, from ${min} to ${amount(max)}`
  }
  if (min !== undefined) return `${defaultWords.value}, at least ${amount(min)}`
  if (max !== undefined) return `${defaultWords.value}, at most ${amount(max)}`
  return defaultWords.value
})
const uses = computed(() => paramUses(props.doc, key.value))
const usedBy = computed(() => (uses.value.length ? `Used by ${listText(uses.value)}` : null))

// -- problems (spec F4) --

const FIELDS = ['label', 'unit', 'default', 'min', 'max', 'key']
const problemFor = (fieldId: string) => props.problems.find((p) => p.fieldId === fieldId)?.message
/** Problems with no field of their own: they show at the top. */
const general = computed(() => props.problems.filter((p) => !FIELDS.includes(p.fieldId!)))
const describedBy = computed(() =>
  props.open || !props.problems.length
    ? undefined
    : props.problems.map((_, i) => `${ids.problem}-${i}`).join(' '),
)

// -- the fields --

const label = computed({
  get: () => param.value.label,
  set: (v: string) => void renameParam(props.doc, props.session, key.value, v),
})
const unit = computed({
  get: () => param.value.unit,
  set: (v: string) => setParamField(param.value, 'unit', v),
})

/** What was typed, kept while it isn't a number, so it can be fixed. */
const typed = reactive<Record<string, string>>({})
const bad = reactive<Record<string, string>>({})
const moreOpen = ref(false)
const keyTyped = ref<string | null>(null)
const keyError = ref<string | null>(null)
const refused = ref<string | null>(null)
watch(
  () => props.open,
  () => {
    for (const k of Object.keys(typed)) delete typed[k]
    for (const k of Object.keys(bad)) delete bad[k]
    keyTyped.value = null
    keyError.value = null
    refused.value = null
  },
)
watch(
  () => props.problems,
  () => {
    if (problemFor('key')) moreOpen.value = true
  },
  { immediate: true },
)

type NumberKey = 'default' | 'min' | 'max'
const numberText = (key: NumberKey) => typed[key] ?? String(param.value[key] ?? '')
/** Writes a typed number, or keeps the text and says what to type. Empty leaves Lowest and Highest out. */
function setNumber(key: NumberKey, raw: string | number | undefined): void {
  const text = String(raw)
  typed[key] = text
  const t = text.trim().replace(',', '.')
  const optional = key !== 'default'
  if (optional && t === '') {
    delete bad[key]
    return setParamField(param.value, key, undefined)
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) {
    const like = `Type a number, like ${param.value.default}`
    bad[key] = optional ? `${like}, or leave it empty.` : `${like}.`
    return
  }
  delete bad[key]
  setParamField(param.value, key, Number(t))
}

function setKey(raw: string | number | undefined): void {
  const next = String(raw)
  keyTyped.value = next
  keyError.value = setParamKey(props.doc, props.session, key.value, next)
}

function remove(): void {
  const refusal = removeParam(props.doc, key.value)
  refused.value = refusal?.message ?? null
  if (!refusal) emit('removed')
}

// -- focus (the card's accessibility) --

const root = useTemplateRef<HTMLElement>('root')
const field = (testid: string) =>
  root.value?.querySelector<HTMLElement>(`input[data-testid="${testid}"]`)
watch(
  () => props.open,
  async (open) => {
    await nextTick()
    if (open) return field('start-value-label')?.focus()
    const at = document.activeElement
    if (at === document.body || root.value!.contains(at)) {
      root.value!.querySelector<HTMLElement>('[data-testid="start-value-open"]')!.focus()
    }
  },
  { flush: 'post' },
)

/** Focuses the field a problem names, opening More for the key; else Label. */
async function focusField(fieldId: string | null): Promise<void> {
  if (fieldId === 'key') moreOpen.value = true
  await nextTick()
  const target =
    (fieldId !== null && FIELDS.includes(fieldId) && field(`start-value-${fieldId}`)) ||
    field('start-value-label')!
  target.focus()
}
defineExpose({ focusField })

const LINK = textLinkVariants()
const ERROR_LINE = 'caption flex items-start gap-2 text-(length:--set-caption) text-error-ink'
const NUMBER = 'w-[calc(var(--u)*140)] min-w-[120px]'
const UNIT_AFTER =
  'pb-[calc((var(--set-control)-1.45em)/2)] text-(length:--set-text) text-ink-secondary'
</script>

<!--
  The StartValueEditor card (brand/design-system/project/components/StartValueEditor): one value
  chosen at start in the programme builder, such as a squat's starting weight. Closed, a row with
  its default and the fields that use it; open in place in 2px ink (K147), its Label, Unit,
  Default, Lowest and Highest, the fields that use it, More: key, and Remove, refused while a field
  uses it (spec §5.5, F5, F7). It reads and writes the draft (spec F1).
-->
<template>
  <li
    v-if="!open"
    ref="root"
    class="flex items-start gap-3 border-b border-line py-3.5"
    data-testid="start-value"
    :data-param="key"
  >
    <span class="min-w-0 flex-auto">
      <span
        class="block text-(length:--set-label) leading-[1.3] font-semibold wrap-anywhere"
        :class="!param.label && 'text-ink-secondary'"
        data-slot="start-value-name"
        >{{ name }}</span
      >
      <span class="block text-(length:--set-text) leading-[1.45]">{{ defaultWords }}</span>
      <span class="caption block text-(length:--set-caption) leading-[1.35] text-ink-secondary">{{
        usedBy ?? 'Used by no field yet.'
      }}</span>
      <span
        v-for="(p, i) in problems"
        :id="`${ids.problem}-${i}`"
        :key="`${p.fieldId}:${p.message}`"
        :class="ERROR_LINE"
        class="mt-1"
        data-testid="start-value-problem"
        ><CircleAlert
          :size="16"
          :stroke-width="1.5"
          class="mt-0.5 shrink-0"
          aria-hidden="true"
        /><span>{{ p.message }}</span></span
      >
    </span>
    <IconButton
      :label="param.label ? `Change ${param.label}` : 'Change this value'"
      aria-expanded="false"
      :aria-describedby="describedBy"
      class="size-[max(44px,calc(var(--u)*52))] folded:h-12 folded:w-11"
      data-testid="start-value-open"
      @click="emit('toggle')"
      ><Pencil
    /></IconButton>
  </li>

  <li
    v-else
    ref="root"
    class="my-3 rounded-lg border-2 border-ink bg-canvas"
    data-testid="start-value"
    :data-param="key"
  >
    <div class="flex items-start gap-2 py-3 pr-2 pl-3 folded:py-2 folded:pr-1 folded:pl-2">
      <button
        type="button"
        class="flex min-w-0 flex-auto cursor-pointer items-start gap-2.5 rounded-sm p-1 text-left text-ink hover:bg-tile"
        aria-expanded="true"
        :aria-controls="ids.body"
        data-slot="start-value-toggle"
        @click="emit('toggle')"
      >
        <ChevronDown
          :stroke-width="1.5"
          class="mt-px size-(--set-icon) shrink-0 text-ink-secondary"
          aria-hidden="true"
        />
        <span class="min-w-0">
          <span
            class="block text-[max(18px,calc(var(--u)*22))] leading-[1.3] font-semibold wrap-anywhere folded:text-[calc(var(--n)*18)]"
            :class="!param.label && 'text-ink-secondary'"
            >{{ name }}</span
          >
          <span class="block text-(length:--set-text) leading-[1.45] text-ink-secondary">{{
            summary
          }}</span>
        </span>
      </button>
    </div>

    <div
      :id="ids.body"
      role="group"
      :aria-label="param.label || 'This value'"
      class="flex flex-col gap-[calc(var(--u)*22)] pt-1 pr-5 pb-5 pl-[calc(var(--u)*54)] folded:gap-[18px] folded:px-3 folded:pb-4"
    >
      <div v-if="general.length" class="flex flex-col gap-1" data-slot="start-value-errors">
        <InlineMessage v-for="p in general" :key="`${p.fieldId}:${p.message}`" tone="error">{{
          p.message
        }}</InlineMessage>
      </div>
      <TextField
        v-model="label"
        label="Label"
        :error="problemFor('label')"
        data-testid="start-value-label"
      />
      <div class="flex flex-wrap items-start gap-x-6 gap-y-5 folded:gap-4">
        <TextField
          v-model="unit"
          label="Unit"
          :error="problemFor('unit')"
          class="w-[calc(var(--u)*110)] min-w-[96px]"
          spellcheck="false"
          autocapitalize="none"
          data-testid="start-value-unit"
        />
        <div class="flex items-end gap-2.5" data-slot="start-value-default">
          <TextField
            label="Default"
            :model-value="numberText('default')"
            :error="bad.default ?? problemFor('default')"
            inputmode="decimal"
            :class="NUMBER"
            data-testid="start-value-default"
            @update:model-value="(v) => setNumber('default', v)"
          />
          <span :class="UNIT_AFTER">{{ param.unit }}</span>
        </div>
      </div>
      <div class="flex flex-col gap-2">
        <div class="flex flex-wrap items-start gap-x-6 gap-y-5 folded:gap-4">
          <div v-for="k in ['min', 'max'] as const" :key="k" class="flex items-end gap-2.5">
            <TextField
              :label="k === 'min' ? 'Lowest' : 'Highest'"
              :model-value="numberText(k)"
              :error="bad[k] ?? problemFor(k)"
              inputmode="decimal"
              :class="NUMBER"
              :data-testid="`start-value-${k}`"
              @update:model-value="(v) => setNumber(k, v)"
            />
            <span :class="UNIT_AFTER">{{ param.unit }}</span>
          </div>
        </div>
        <p class="caption text-(length:--set-caption) leading-[1.35] text-ink-secondary">
          Lowest and highest are optional. The start asks for a value between them.
        </p>
      </div>
      <p
        class="caption text-(length:--set-caption) leading-[1.35] text-ink"
        data-testid="start-value-used"
      >
        {{ usedBy ? `${usedBy}.` : 'Used by no field yet.' }}
      </p>
      <button
        type="button"
        :class="LINK"
        class="inline-flex items-center gap-1.5 self-start text-(length:--set-text) [&_svg]:size-5.5"
        :aria-expanded="moreOpen ? 'true' : 'false'"
        :aria-controls="moreOpen ? ids.more : undefined"
        data-testid="start-value-more"
        @click="moreOpen = !moreOpen"
      >
        <component :is="moreOpen ? ChevronDown : ChevronRight" :stroke-width="1.5" />More: key
      </button>
      <div v-if="moreOpen" :id="ids.more">
        <TextField
          :model-value="keyTyped ?? key"
          label="Key"
          hint="A start through Claude names the value by it. Lowercase letters, numbers and dashes."
          :error="keyError ?? problemFor('key')"
          spellcheck="false"
          autocapitalize="none"
          data-testid="start-value-key"
          @update:model-value="setKey"
        />
      </div>
      <div class="flex flex-col items-start gap-2">
        <Button
          variant="quiet"
          class="h-[max(44px,calc(var(--u)*52))] text-(length:--set-label) folded:h-12"
          :aria-describedby="refused ? ids.refused : undefined"
          data-testid="start-value-remove"
          @click="remove"
          ><Trash2 :stroke-width="1.5" />Remove</Button
        >
        <InlineMessage
          v-if="refused"
          :id="ids.refused"
          tone="error"
          data-testid="start-value-refused"
          >{{ refused }}</InlineMessage
        >
      </div>
    </div>
  </li>
</template>
