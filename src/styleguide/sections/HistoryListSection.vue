<script setup lang="ts">
import { ref } from 'vue'
import { HistoryList } from '@/components/ui/history-list'
import ExampleGroup from '../parts/ExampleGroup.vue'
import StateExample from '../parts/StateExample.vue'
import { historyExamples } from './historyExamples'

const now = new Date()
const items = historyExamples(now)
const current = ref('diet')
</script>

<!-- The card's states (components/HistoryList/preview.html) in the SidePanel's body: grouped, one
     open (press another to open it), and empty. Delete and Delete all do nothing here; the page
     asks first. -->
<template>
  <ExampleGroup>
    <StateExample state="Grouped, one open; hover or Tab to an item for its bin">
      <div class="flex w-75 max-w-full flex-col rounded-lg border border-line bg-panel p-3">
        <HistoryList
          id="sg-history-list-default"
          :items="items"
          :current-id="current"
          :now="now"
          @open="current = $event"
        />
      </div>
    </StateExample>
    <StateExample state="Empty">
      <div class="flex w-75 max-w-full flex-col rounded-lg border border-line bg-panel p-3">
        <HistoryList id="sg-history-list-empty" :items="[]" :now="now" />
      </div>
    </StateExample>
  </ExampleGroup>
</template>
