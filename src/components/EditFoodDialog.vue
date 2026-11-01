<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDietStore } from '@/stores/diet'
import { useDetailsStore } from '@/stores/details'
import {
  MAX_DETAILS_NOTES,
  MAX_TARGET,
  MIN_TARGET,
  NEW_FOOD_TARGET,
  NOTES_COUNT_FROM,
  type Food,
} from '@/lib/storage'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Stepper } from '@/components/ui/stepper'
import { TextArea } from '@/components/ui/text-area'
import { TextField } from '@/components/ui/text-field'

const props = defineProps<{
  /** The food to edit; left out, the dialog adds a new one (K54). */
  food?: Food
}>()
const emit = defineEmits<{ close: [] }>()

const diet = useDietStore()
const details = useDetailsStore()
const name = ref(props.food?.name ?? '')
const target = ref(props.food?.target ?? NEW_FOOD_TARGET)
// The Note field is the food's notes, the same on every week (D2); the rest is this week's.
const notes = ref(props.food ? details.notesOf('diet', props.food.id) : '')
/** Add or edit: the title, the fields' ids and the primary action follow. */
const adding = !props.food
const id = adding ? 'add-food' : 'edit-food'
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
  // Nothing changes unless the notes can be saved too.
  if (!details.canSetNotes('diet', props.food?.id ?? null, notes.value)) {
    noteError.value = NOTE_TOO_BIG
    return
  }
  const input = { name: name.value, target: target.value }
  const saved = props.food
    ? diet.updateFood(props.food.id, input) && props.food.id
    : diet.addFood(input)
  if (!saved) return
  details.setNotes('diet', saved, notes.value)
  emit('close')
}
</script>

<!-- The Dialog card's Edit food, or Add food when no food is given (K54): Name, Times a week,
     then the Note last, as in the exercise's dialog (K55). Open for as long as it is mounted, like EditExerciseDialog; the Dialog returns focus to
     the button that opened it. -->
<template>
  <Dialog :open="true" :title="adding ? 'Add food' : 'Edit food'" @update:open="emit('close')">
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
      <Stepper
        :id="`${id}-target`"
        v-model="target"
        label="Times a week"
        lower-label="Fewer times a week"
        raise-label="More times a week"
        :min="MIN_TARGET"
        :max="MAX_TARGET"
      />
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
        adding ? 'Add food' : 'Save'
      }}</Button>
    </template>
  </Dialog>
</template>
