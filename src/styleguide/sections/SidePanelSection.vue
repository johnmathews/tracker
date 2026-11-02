<script setup lang="ts">
import { ref, useTemplateRef } from 'vue'
import { ChevronLeft, PanelLeft, SquarePen } from '@lucide/vue'
import { HistoryList } from '@/components/ui/history-list'
import { IconButton } from '@/components/ui/icon-button'
import { SidePanel } from '@/components/ui/side-panel'
import { historyExamples } from './historyExamples'

const open = ref(true)
const now = new Date()
const items = historyExamples(now)
const current = ref('diet')
const panel = useTemplateRef<InstanceType<typeof SidePanel>>('panel')

function pick(id: string): void {
  current.value = id
  panel.value?.close()
}
</script>

<!-- The shell at a fixed height, with HistoryList in it (components/SidePanel/preview.html). Hide
     it to see the strip; under 760px wide (or an upright iPad) it is a drawer, opened by the
     toggle beside "Back to the week". Nothing here is remembered. -->
<template>
  <SidePanel
    id="sg-side-panel-default"
    ref="panel"
    v-model:open="open"
    class="h-105 overflow-hidden rounded-lg border border-line"
  >
    <template #title>History</template>
    <template #strip>
      <IconButton label="New conversation"><SquarePen /></IconButton>
    </template>
    <template #panel>
      <HistoryList :items="items" :current-id="current" :now="now" @open="pick" />
    </template>
    <template #default="{ folded, panelId }">
      <div class="px-[calc(var(--u)*24)] py-[calc(var(--u)*22)]">
        <div class="flex items-center gap-1">
          <IconButton
            v-if="folded"
            label="Show history"
            :aria-expanded="open ? 'true' : 'false'"
            :aria-controls="panelId"
            class="-ml-2"
            @click="open = true"
          >
            <PanelLeft />
          </IconButton>
          <span class="inline-flex items-center gap-1.5 text-(length:--set-text) text-ink">
            <ChevronLeft :size="22" :stroke-width="1.5" />Back to the week
          </span>
        </div>
        <p class="title-1 mt-3 text-ink">Ask</p>
        <p class="body mt-4 max-w-[60ch] text-ink">
          Fruit and Nuts are on track: five and three days most weeks.
        </p>
      </div>
    </template>
  </SidePanel>
</template>
