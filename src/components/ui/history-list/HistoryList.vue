<script setup lang="ts">
import { computed, useId } from 'vue'
import { SquarePen, Trash2 } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { groupHistory, type HistoryItem } from '.'

const props = defineProps<{
  /** Every past conversation, newest first. */
  items: readonly HistoryItem[]
  /** The open conversation, if any. */
  currentId?: string
  /** For the groups: Today, Last week, Earlier. */
  now: Date
}>()

/**
 * Each says which was pressed. Deleting asks first, and the page asks (a ConfirmDialog through
 * useConfirm, as Edit plan's Remove does); each bin carries `data-history-delete` with its id, so
 * the page can return focus to it on Cancel.
 */
const emit = defineEmits<{
  open: [id: string]
  new: []
  delete: [id: string]
  deleteAll: []
}>()

const base = useId()
const groups = computed(() => groupHistory(props.items, props.now))
</script>

<!--
  Past conversations in the SidePanel's body on the Ask page
  (brand/design-system/project/components/HistoryList), S1: New conversation, the groups (which
  scroll on their own), and Delete all conversations above a hairline. The open one is on a tile,
  bold; a bin shows on it, on hover and on focus, and always on a touch screen. The scroller keeps
  4px of room on every side, so a focus ring is never clipped.
-->
<template>
  <div data-slot="history-list" class="flex min-h-0 flex-1 flex-col gap-[calc(var(--u)*12)]">
    <Button class="w-full justify-start" @click="emit('new')">
      <SquarePen :stroke-width="1.5" />New conversation
    </Button>
    <div
      v-if="groups.length > 0"
      class="-m-1 grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-[calc(var(--u)*16)] overflow-y-auto p-1"
    >
      <div
        v-for="(group, g) in groups"
        :key="group.label"
        role="group"
        :aria-labelledby="`${base}-g${g}`"
      >
        <h3
          :id="`${base}-g${g}`"
          class="label mb-[calc(var(--u)*4)] px-[calc(var(--u)*8)] text-(length:--set-caption) text-ink-secondary"
        >
          {{ group.label }}
        </h3>
        <ul class="grid grid-cols-[minmax(0,1fr)] gap-0.5">
          <li
            v-for="item in group.items"
            :key="item.id"
            class="group/item flex items-center rounded-md focus-within:bg-tile hover:bg-tile"
            :class="item.id === currentId ? 'bg-tile' : undefined"
          >
            <button
              type="button"
              data-slot="history-open"
              :aria-current="item.id === currentId ? 'true' : undefined"
              class="block min-w-0 flex-1 truncate rounded-md px-[calc(var(--u)*8)] py-[calc(var(--u)*9)] text-left text-(length:--set-label) leading-[1.4] text-ink"
              :class="item.id === currentId ? 'font-semibold' : undefined"
              @click="emit('open', item.id)"
            >
              {{ item.title }}
            </button>
            <IconButton
              :label="`Delete “${item.title}”`"
              :data-history-delete="item.id"
              class="text-ink-secondary hover:not-disabled:bg-canvas hover:not-disabled:text-ink [&_svg]:size-4.5"
              :class="
                item.id === currentId
                  ? 'opacity-100'
                  : 'opacity-0 group-focus-within/item:opacity-100 group-hover/item:opacity-100 [@media(hover:none)]:opacity-100'
              "
              @click="emit('delete', item.id)"
            >
              <Trash2 />
            </IconButton>
          </li>
        </ul>
      </div>
    </div>
    <p
      v-if="groups.length > 0"
      data-slot="history-foot"
      class="border-t border-line pt-[calc(var(--u)*8)]"
    >
      <button
        type="button"
        class="min-h-11 rounded-sm px-[calc(var(--u)*8)] text-(length:--set-caption) text-ink-secondary underline underline-offset-3 hover:text-ink"
        @click="emit('deleteAll')"
      >
        Delete all conversations
      </button>
    </p>
    <p
      v-else
      data-slot="history-empty"
      class="caption px-[calc(var(--u)*8)] text-(length:--set-caption) text-ink-secondary"
    >
      Past conversations show here.
    </p>
  </div>
</template>
