import { computed, onBeforeUnmount, ref, watch, type ComputedRef, type Ref } from 'vue'
import { useSyncStore } from '@/stores/sync'
import { usePlannerStore } from '@/stores/planner'

/** How long typing in a note rests before it is saved (F18). */
export const NOTE_PAUSE_MS = 600

/** What a Profile note (My goals, Your limits) reads and writes in the planner store. */
export type NoteBinding = {
  /** The saved text. */
  saved: () => string
  /** Whether the saved text is known: read, cached with it, or set by the person (F1). */
  known: () => boolean
  /** Save the text; the store normalises it, and the same text again is no change. */
  set: (text: string) => void
  /** The store's normaliser, so a draft that only differs in blank ends counts as the saved text. */
  normalise: (text: string) => string
}

export type NoteDraft = {
  draft: Ref<string>
  editable: ComputedRef<boolean>
  onInput: () => void
  commit: () => void
}

/**
 * A note's box on the Profile page: it keeps its own draft, saved when the person stops typing
 * for a moment or leaves the box, so one pause is one write (F18). The draft is never trimmed
 * while typing. Text saved elsewhere (another tab, the server) shows here unless the person is
 * mid-pause, and a draft still pending when the page closes is saved then.
 *
 * Typing may replace the note only once it is known: read from the server or a cache that carried
 * it, or an account the server says has no settings at all (a new one), whose notes are empty.
 * Until then a stand-in would erase the saved one (F1).
 */
export function useNoteDraft(note: NoteBinding): NoteDraft {
  const planner = usePlannerStore()
  const sync = useSyncStore()
  const draft = ref(note.saved())
  let timer: ReturnType<typeof setTimeout> | undefined
  const editable = computed(() => note.known() || (sync.fresh && planner.savedSettings() === null))

  function commit(): void {
    clearTimeout(timer)
    timer = undefined
    if (editable.value) note.set(draft.value)
  }
  function onInput(): void {
    clearTimeout(timer)
    timer = setTimeout(commit, NOTE_PAUSE_MS)
  }
  watch(note.saved, (saved) => {
    if (timer === undefined && saved !== note.normalise(draft.value)) draft.value = saved
  })
  onBeforeUnmount(() => {
    if (timer !== undefined) commit()
  })

  return { draft, editable, onInput, commit }
}
