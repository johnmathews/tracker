<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useCardioStore } from '@/stores/cardio'
import { useDetailsStore } from '@/stores/details'
import { useCardioForm } from '@/composables/cardioForm'
import { detailsIdProblem } from '@/lib/problems'
import {
  MAX_DETAILS_NOTES,
  MAX_TARGET,
  MIN_TARGET,
  NOTES_COUNT_FROM,
  type Cardio,
} from '@/lib/storage'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Stepper } from '@/components/ui/stepper'
import { TextArea } from '@/components/ui/text-area'
import { TextField } from '@/components/ui/text-field'

const props = defineProps<{
  /** The item to edit; left out, the dialog adds a new one (K54). */
  item?: Cardio
}>()
const emit = defineEmits<{ close: [] }>()

const cardio = useCardioStore()
const details = useDetailsStore()
const form = useCardioForm()
const { name, minutes, distance, target, notes } = form
// The Note field is the item's notes, the same on every week (D2); the rest is this week's.
/** The notes as the dialog opened with them: Save writes them only if they changed since. */
const loadedNotes = props.item ? details.notesOf('cardio', props.item.id) : ''
form.load(props.item, loadedNotes)
/** Add or edit: the title, the fields' ids and the primary action follow. */
const adding = !props.item
const id = adding ? 'add-cardio' : 'edit-cardio'
/** The Dialog card's hint under Note (K43). */
const NOTE_HINT = 'Markdown works: **bold**, *italic*, links.'
/** Notes the API could not store, though within the field's 20,000 characters (32 KB). */
const NOTE_TOO_BIG = 'These notes are too long to save. Shorten them, then save again.'
/** The count shows once the notes near their limit (TextArea card). */
const noteCount = computed(() =>
  notes.value.length >= NOTES_COUNT_FROM ? MAX_DETAILS_NOTES : undefined,
)
const noteError = ref<string | undefined>()
watch(notes, () => (noteError.value = undefined))

function save(): void {
  // Untouched notes stay as the store has them now: a newer copy may have arrived meanwhile.
  const notesChanged = notes.value !== loadedNotes
  const itemId = props.item?.id ?? null
  // Nothing changes unless the notes can be saved too.
  if (notesChanged && !details.canSetNotes('cardio', itemId, notes.value)) {
    noteError.value = (itemId && detailsIdProblem(itemId, 'notes')) || NOTE_TOO_BIG
    return
  }
  const saved = props.item
    ? cardio.updateCardio(props.item.id, form.value()) && props.item.id
    : cardio.addCardio(form.value())
  if (!saved) return
  if (notesChanged) details.setNotes('cardio', saved, notes.value)
  emit('close')
}
</script>

<!-- The Dialog card's Edit cardio, or Add cardio when no item is given (K54, K90): Name, then
     Minutes, Distance in km and Times a week on one row, then the Note last, as in the exercise's
     dialog (K55). Either amount may stay blank. Open for as long as it is mounted, like
     EditExerciseDialog; the Dialog returns focus to the button that opened it. -->
<template>
  <Dialog :open="true" :title="adding ? 'Add cardio' : 'Edit cardio'" @update:open="emit('close')">
    <form
      :id="`${id}-form`"
      class="flex flex-col gap-[max(16px,calc(var(--u)*20))]"
      @submit.prevent="save"
    >
      <TextField
        :id="`${id}-name`"
        v-model="name"
        label="Name"
        required
        pattern=".*\S.*"
        title="Enter a name"
      />
      <div
        class="flex flex-wrap items-start gap-x-[max(16px,calc(var(--u)*24))] gap-y-[max(16px,calc(var(--u)*20))]"
      >
        <TextField
          :id="`${id}-minutes`"
          :model-value="minutes"
          label="Minutes"
          inputmode="decimal"
          maxlength="7"
          data-field="minutes"
          class="w-[max(5rem,calc(var(--u)*96))]"
          @input="form.onMinutesInput"
        />
        <TextField
          :id="`${id}-distance`"
          :model-value="distance"
          label="Distance in km"
          inputmode="decimal"
          maxlength="7"
          data-field="distance"
          class="w-[max(11rem,calc(var(--u)*170))]"
          @input="form.onDistanceInput"
        />
        <Stepper
          :id="`${id}-target`"
          v-model="target"
          label="Times a week"
          lower-label="Fewer times a week"
          raise-label="More times a week"
          :min="MIN_TARGET"
          :max="MAX_TARGET"
        />
      </div>
      <TextArea
        :id="`${id}-notes`"
        v-model="notes"
        label="Note"
        :hint="NOTE_HINT"
        :error="noteError"
        :max-length="noteCount"
        :maxlength="MAX_DETAILS_NOTES"
        rows="3"
      />
    </form>
    <template #actions>
      <Button @click="emit('close')">Cancel</Button>
      <Button type="submit" :form="`${id}-form`" variant="primary">{{
        adding ? 'Add cardio' : 'Save'
      }}</Button>
    </template>
  </Dialog>
</template>
