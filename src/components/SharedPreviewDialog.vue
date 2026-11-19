<script setup lang="ts">
import { computed } from 'vue'
import { CopyPlus } from '@lucide/vue'
import type { SharedPreview } from '@/lib/programmes'
import { factsLine, planLine } from '@/lib/sharedLibrary'
import SharedActivities from '@/components/SharedActivities.vue'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { InlineMessage } from '@/components/ui/inline-message'
import { ProgrammeGrid } from '@/components/ui/programme-grid'

const props = defineProps<{
  /** The server's preview: the document, and its plan at its own values (P4). */
  preview: SharedPreview
  /** The library already has a programme of this name: copying adds another (K172). */
  warning?: string | null
  /** Why the copy failed, said in the dialog. */
  error?: string | null
  busy?: boolean
  /** Offline: Copy to library is disabled, as on the row. */
  offline?: boolean
}>()

const emit = defineEmits<{
  /** Copy to library, pressed: the preview was the look before it, so it doesn't ask again. */
  copy: []
}>()

const open = defineModel<boolean>('open', { default: false })

const programme = computed(() => props.preview.programme)

const META = 'body text-(length:--set-text) leading-[1.45] text-ink-secondary'
const TEXT = 'body text-(length:--set-text) leading-[1.45] text-ink'
</script>

<!--
  Preview, on a shared row (K173, option C of the mockup 261119-shared-preview). The Dialog card,
  titled with the programme's name: its facts and description, its plan (a line, then the
  ProgrammeGrid as the start's preview, weeks by number), and each activity with its notes and
  link. Close, then Copy to library. Opening it, the dialog was the look: Copy copies without the
  row's question, and says first when the library already has one of that name.
-->
<template>
  <Dialog v-model:open="open" :title="programme.name" class="sm:max-w-[calc(100vw-96px)]">
    <div class="flex min-w-0 flex-col gap-3" data-testid="shared-preview">
      <p :class="META">{{ factsLine(programme) }}</p>
      <p v-if="programme.description" :class="TEXT" class="max-w-[60ch]">
        {{ programme.description }}
      </p>
      <p :class="META" data-testid="shared-preview-line">{{ planLine(preview.plan) }}</p>
      <ProgrammeGrid
        :grid="preview.plan.grid"
        :kind="programme.kind"
        mode="start"
        undated
        label="The plan, week by week"
        style="--grid-ground: var(--panel)"
      />
      <SharedActivities :doc="programme.doc" />
    </div>
    <InlineMessage v-if="warning" tone="info" data-testid="shared-preview-warning">{{
      warning
    }}</InlineMessage>
    <InlineMessage v-if="error" tone="error" data-testid="shared-preview-error">{{
      error
    }}</InlineMessage>
    <template #actions>
      <Button @click="open = false">Close</Button>
      <Button
        variant="primary"
        :busy="busy"
        :disabled="offline"
        data-testid="shared-preview-copy"
        @click="emit('copy')"
        ><CopyPlus :stroke-width="1.5" />Copy to library</Button
      >
    </template>
  </Dialog>
</template>
