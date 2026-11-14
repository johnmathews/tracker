<script setup lang="ts">
import { createPinia, setActivePinia } from 'pinia'
import NewTrackerPage from '@/components/NewTrackerPage.vue'
import ExampleGroup from '../parts/ExampleGroup.vue'
import StateExample from '../parts/StateExample.vue'

// The style guide has no store of its own: the page reads one set up here, empty; nothing is saved.
setActivePinia(createPinia())
</script>

<!-- The app's own new tracker page (components/NewTrackerPage/preview.html), in a frame on the
     page's margins. The Kind control and its line work; Add tracker adds to this page's store
     only. -->
<template>
  <ExampleGroup>
    <StateExample state="An empty name, Strength chosen" class="w-full">
      <div
        id="sg-new-tracker-page-empty"
        class="w-full rounded-lg border border-line px-(--screen-pad-x)"
      >
        <NewTrackerPage example />
      </div>
    </StateExample>
  </ExampleGroup>
</template>
