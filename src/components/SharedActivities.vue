<script setup lang="ts">
import { computed } from 'vue'
import { renderNote } from '@/lib/markdown'
import type { ProgrammeDoc } from '@/lib/programmes'
import { activityChip, activityLink } from '@/lib/sharedLibrary'
import { Chip } from '@/components/ui/chip'
import { TextLink } from '@/components/ui/text-link'

const props = defineProps<{ doc: ProgrammeDoc }>()

const activities = computed(() =>
  props.doc.activities.map((a) => ({
    key: a.key,
    name: a.name,
    chip: activityChip(a),
    notes: typeof a.notes === 'string' && a.notes.trim() ? renderNote(a.notes) : null,
    link: activityLink(a),
  })),
)
</script>

<!--
  A shared programme's activities, as Publish's preview (S5) and the shared preview (K173) list
  them: each name with its chip, its notes as a note shows them ("No notes." without), and its link.
-->
<template>
  <ol aria-label="Activities" class="border-t border-line">
    <li
      v-for="a in activities"
      :key="a.key"
      class="flex flex-col gap-1 border-b border-line py-3 last:border-b-0 last:pb-0"
      data-testid="shared-activity"
    >
      <span
        class="flex flex-wrap items-center gap-x-2 gap-y-1 text-(length:--set-label) leading-[1.3] font-semibold"
        >{{ a.name }}<Chip v-if="a.chip">{{ a.chip }}</Chip></span
      >
      <!-- eslint-disable-next-line vue/no-v-html -- markdown-it with raw HTML off (lib/markdown) -->
      <div
        v-if="a.notes"
        class="note-body max-w-[60ch] font-serif text-(length:--set-text) leading-[1.55] text-ink italic"
        v-html="a.notes"
      ></div>
      <p v-else class="caption text-(length:--set-caption) leading-[1.35] text-ink-secondary">
        No notes.
      </p>
      <TextLink
        v-if="a.link"
        :href="a.link.href"
        target="_blank"
        rel="noopener noreferrer"
        class="self-start text-(length:--set-caption) break-all"
        >Open {{ a.link.host }} in a new tab</TextLink
      >
    </li>
  </ol>
</template>
