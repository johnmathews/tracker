<script setup lang="ts">
import { Pencil, Plus, Trash2 } from '@lucide/vue'
import { SectionHeader } from '@/components/ui/section-header'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import ExampleGroup from '../parts/ExampleGroup.vue'
import StateExample from '../parts/StateExample.vue'

/** Edit plan's buttons at the page's control size, as TrackerSection sets them. */
const CONTROL =
  'h-(--set-control) px-(--set-control-pad) text-(length:--set-label) [&_svg]:size-(--set-icon)'
</script>

<!-- The card's headers (components/SectionHeader/preview.html), in its copy. The week is the
     page's title, fixed above the planner's screens (K88), so a header has none. -->
<template>
  <ExampleGroup>
    <StateExample state="Strength" class="w-full">
      <SectionHeader
        id="sg-section-header-strength"
        class="w-full"
        title="Strength"
        heading-id="sg-section-header-strength-title"
      />
    </StateExample>
    <StateExample state="In Edit plan: the pen, Add and Delete tracker" class="w-full">
      <SectionHeader
        id="sg-section-header-edit"
        class="w-full"
        title="Strength"
        heading-id="sg-section-header-edit-title"
      >
        <template #title>
          <IconButton
            label="Rename Strength"
            class="size-(--edit-ib) text-ink-secondary hover:text-ink [&_svg]:size-(--edit-ib-icon)"
            ><Pencil
          /></IconButton>
        </template>
        <template #end>
          <div class="flex flex-wrap items-center justify-end gap-[calc(var(--u)*12)]">
            <Button :class="CONTROL"><Plus :stroke-width="1.5" />Add exercise</Button>
            <Button :class="CONTROL"><Trash2 :stroke-width="1.5" />Delete tracker</Button>
          </div>
        </template>
      </SectionHeader>
    </StateExample>
    <StateExample state="With a hint" class="w-full">
      <SectionHeader
        id="sg-section-header-hint"
        class="w-full"
        title="Food"
        heading-id="sg-section-header-hint-title"
        hint="Mark each day you ate it."
      />
    </StateExample>
  </ExampleGroup>
</template>
