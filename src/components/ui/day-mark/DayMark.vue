<script setup lang="ts">
import { computed, type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import type { Mark, MarkSet } from '@/lib/storage'
import { dayMarkLabel } from '.'
import DayMarkDrawing from './DayMarkDrawing.vue'

const props = withDefaults(
  defineProps<{
    /** The row: "Push-ups", "Fish". */
    name: string
    /** The full date for the name: "Thursday 22 October". The visible header can stay "Thu 22". */
    date: string
    /** The day's mark, or `null` for an empty box. */
    mark: Mark | null
    /** Adds "today" to the name and aria-current="date". The band is the grid cell's to draw. */
    today?: boolean
    /** Draws the folded corner and adds "has a note" to the name. Only where a note exists. */
    note?: boolean
    /** How the mark is drawn: the device's mark set (K20). The squiggles by default. */
    set?: MarkSet
    /**
     * Fills its cell on screen (K24): the cell must be a size container (WeekGrid's day cells
     * are). The button takes 86% of the cell's shorter side, up to 128px; paper keeps 64px.
     */
    fill?: boolean
    class?: HTMLAttributes['class']
  }>(),
  { today: false, note: false, set: 'squiggles', fill: false, class: undefined },
)

defineEmits<{ toggle: [] }>()

const label = computed(() => dayMarkLabel(props))
</script>

<!--
  One day of one row (brand/design-system/project/components/DayMark): a 64px button centred in a
  76px square cell, drawing a hand-drawn box about 45px across in control-border. A marked day is
  drawn in its pen (green great, yellow partial, red missed) as the device's mark set says: the
  squiggles fill it with the marker drawing its mark names (zigzag or hatch), Filled in with the
  solid fill (K141); a tick or face
  set strokes its symbol (tick, wave, wave; happy, so-so, so-so), or stamps it, the box filled
  solid with the symbol in paper. The ink runs a little past the box, and the box is drawn over it,
  as a pen line shows through marker. The rest of the cell is quiet space, so the 2px focus ring at 2px
  offset never touches a neighbour. With `fill`, on screen the whole thing scales to its cell
  (DayMark card, Filling a cell), the drawing at 94% of the button.
-->
<template>
  <div
    data-slot="day-mark"
    :data-today="today"
    :class="
      cn(
        'relative mx-auto grid size-19 place-items-center',
        fill && 'screen:size-full',
        props.class,
      )
    "
  >
    <button
      type="button"
      data-slot="day-mark-button"
      class="group grid size-16 place-items-center rounded-md"
      :class="fill && 'screen:size-[min(86cqw,86cqh,128px)]'"
      :aria-pressed="mark !== null"
      :aria-label="label"
      :aria-current="today ? 'date' : undefined"
      @click="$emit('toggle')"
    >
      <DayMarkDrawing :mark="mark" :set="set" :class="fill && 'screen:size-[94%]'" />
    </button>
    <!-- NoteMark: a 10px folded corner in ink-secondary, flush in the cell's top-right corner. -->
    <span
      v-if="note"
      data-slot="note-mark"
      aria-hidden="true"
      class="pointer-events-none absolute top-0 right-0 size-2.5 bg-ink-secondary [clip-path:polygon(0_0,100%_0,100%_100%)]"
    />
  </div>
</template>
