<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/lib/utils'
import { markKind, type Mark, type MarkSet } from '@/lib/storage'
import { BOX_PATH, FACE_EYES, MARK_DRAWINGS, MARK_PENS, markLook } from '.'

const STAMP_PATH = MARK_DRAWINGS.solid

const props = withDefaults(
  defineProps<{
    /** The mark, or `null` for an empty box. */
    mark: Mark | null
    /** How the mark is drawn: the device's mark set (K20). The squiggles by default. */
    set?: MarkSet
  }>(),
  { set: 'squiggles' },
)

const look = computed(() => (props.mark ? markLook(props.set, props.mark) : null))
</script>

<!--
  A day's mark as a picture (brand/design-system/project/components/DayMark): the hand-drawn box,
  60px on a 36-unit square, and the mark in its pen as the mark set says. The squiggles fill the
  box with the marker drawing the mark names (zigzag or hatch; a solid one as the zigzag), Filled
  in with the solid fill (K141); a tick or face set strokes
  its symbol (tick, wave, wave; happy, so-so, so-so), or stamps it, the box filled solid with the
  symbol in paper. The ink runs a little past the box, and the box is drawn over it, as a pen line
  shows through marker. Not pressable: DayMark puts it in its button, and the Marks setting shows
  each set with it. An empty box darkens on hover of the enclosing `group`.
-->
<template>
  <svg
    data-slot="day-mark-box"
    aria-hidden="true"
    viewBox="0 0 36 36"
    :data-mark="mark ? markKind(mark) : undefined"
    fill="none"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="size-15 overflow-visible"
  >
    <template v-if="mark && look">
      <path
        v-if="look.type === 'drawing'"
        :d="look.path"
        data-slot="day-mark-stroke"
        :data-drawing="look.drawing"
        fill="currentColor"
        fill-rule="evenodd"
        stroke="none"
        :class="MARK_PENS[markKind(mark)]"
      />
      <template v-else>
        <path
          v-if="look.stamped"
          :d="STAMP_PATH"
          data-slot="day-mark-stroke"
          data-drawing="solid"
          fill="currentColor"
          fill-rule="evenodd"
          stroke="none"
          :class="MARK_PENS[markKind(mark)]"
        />
        <g
          data-slot="day-mark-symbol"
          :data-set="set"
          :data-stamped="look.stamped"
          :class="look.stamped ? 'text-canvas' : MARK_PENS[markKind(mark)]"
        >
          <path :d="look.symbol.path" stroke="currentColor" :stroke-width="look.width" />
          <template v-if="look.symbol.eyes">
            <circle
              v-for="[cx, cy] in FACE_EYES"
              :key="cx"
              :cx="cx"
              :cy="cy"
              :r="look.eye"
              fill="currentColor"
              stroke="none"
            />
          </template>
        </g>
      </template>
    </template>
    <path
      :d="BOX_PATH"
      data-slot="day-mark-outline"
      stroke-width="1.75"
      :class="
        cn(
          'stroke-control-border motion-safe:transition-[stroke] motion-safe:duration-120 motion-safe:ease-out',
          mark === null && 'group-hover:stroke-ink',
        )
      "
    />
  </svg>
</template>
