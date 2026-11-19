<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import type { PublishPreview } from '@/lib/programmes'
import {
  PUBLISH_STALE,
  PUBLISH_WHO,
  factsLine,
  publishTitle,
  replacesLine,
} from '@/lib/sharedLibrary'
import { useProgrammesStore } from '@/stores/programmes'
import SharedActivities from '@/components/SharedActivities.vue'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { InlineMessage } from '@/components/ui/inline-message'

const props = defineProps<{
  /** The library programme being published. */
  programmeId: string
  /** The server's preview (S5): what everyone will see, and the shared copy it replaces. */
  preview: PublishPreview
}>()

const emit = defineEmits<{
  /** The programme is in the shared library, under this name. */
  published: [name: string]
}>()

const open = defineModel<boolean>('open', { default: false })

const store = useProgrammesStore()
const seenId = useId()

/** The preview shown: the one opened with, or a fresh one after a stale `rev`. */
const shown = ref<PublishPreview>(props.preview)
/** The programme changed since the preview: the fresh one shows, with a line saying so. */
const stale = ref(false)
const error = ref<string | null>(null)
const busy = ref(false)

watch(
  () => props.preview,
  (next) => {
    shown.value = next
    stale.value = false
    error.value = null
  },
)

const programme = computed(() => shown.value.publish.programme)
const replaces = computed(() => shown.value.publish.replaces)
const title = computed(() => publishTitle(programme.value.name, replaces.value !== null))

/** Publish with the preview's `rev` (P2). A stale `rev` shows the fresh preview instead. */
async function confirm(): Promise<void> {
  if (busy.value) return
  busy.value = true
  const res = await store.publish(props.programmeId, shown.value.rev)
  busy.value = false
  if (res.ok) {
    open.value = false
    emit('published', programme.value.name)
    return
  }
  if ('stale' in res) {
    shown.value = res.stale
    stale.value = true
    error.value = null
    return
  }
  error.value = res.message
}

const NAME =
  'text-[max(18px,calc(var(--u)*22))] leading-[1.3] font-semibold folded:text-[calc(var(--n)*18)]'
const META = 'body text-(length:--set-text) leading-[1.45] text-ink-secondary'
const TEXT = 'body text-(length:--set-text) leading-[1.45] text-ink'
</script>

<!--
  Publish, from an admin's More menu on a library row (K171, the shared library spec §7, S5). The
  Dialog card, opened on the server's preview: "What everyone will see" (the programme on the page's
  canvas in a line frame: its name, the facts, the description, then each activity with its chip,
  its notes as a note shows them, and its link), then who sees it. Publish again first says what it
  replaces. Nothing is shared until Publish programme (P2), which sends the preview's rev; a stale
  rev shows the fresh preview with a line saying so.
-->
<template>
  <Dialog v-model:open="open" :title="title">
    <InlineMessage v-if="stale" tone="info" data-testid="publish-stale">{{
      PUBLISH_STALE
    }}</InlineMessage>
    <p v-if="replaces" :class="TEXT" data-testid="publish-replaces">
      {{ replacesLine(replaces) }}
    </p>
    <section :aria-labelledby="seenId" class="flex flex-col gap-2" data-testid="publish-preview">
      <h3 :id="seenId" class="label text-(length:--set-label) leading-[1.3] font-semibold text-ink">
        What everyone will see
      </h3>
      <div class="min-w-0 rounded-md border border-line bg-canvas px-5 py-4 folded:p-3">
        <p :class="NAME">{{ programme.name }}</p>
        <p :class="META">{{ factsLine(programme) }}</p>
        <p v-if="programme.description" :class="TEXT" class="mt-1 max-w-[60ch]">
          {{ programme.description }}
        </p>
        <SharedActivities :doc="programme.doc" class="mt-4" />
      </div>
    </section>
    <p :class="TEXT" data-testid="publish-who">{{ PUBLISH_WHO }}</p>
    <InlineMessage v-if="error" tone="error" data-testid="publish-error">{{ error }}</InlineMessage>
    <template #actions>
      <Button @click="open = false">Cancel</Button>
      <Button variant="primary" :busy="busy" data-testid="publish-confirm" @click="confirm">{{
        replaces ? 'Publish again' : 'Publish programme'
      }}</Button>
    </template>
  </Dialog>
</template>
