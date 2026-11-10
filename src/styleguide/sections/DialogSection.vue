<script setup lang="ts">
import { ref } from 'vue'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Stepper } from '@/components/ui/stepper'
import { TextField } from '@/components/ui/text-field'

const MEASURE = [
  { value: 'reps', label: 'Reps' },
  { value: 'time', label: 'Time' },
]
const REPS_COUNT = [
  { value: 'per-set', label: 'Per set' },
  { value: 'each-side', label: 'Each side' },
]

const open = ref(false)
const name = ref('Kettlebell halos')
const sets = ref('3')
const reps = ref('8')
const measure = ref('reps')
const repsCount = ref('each-side')
const target = ref(2)
const weight = ref('8')
</script>

<!-- The card's example (components/Dialog/preview.html): Edit exercise as it was before K104.
     Nothing in the app opens a Dialog now; an item's page edits an item. It opens from its trigger
     only, so nothing traps the page on load; focus goes to the first field and returns to the
     trigger on close. -->
<template>
  <Dialog v-model:open="open" title="Edit exercise">
    <template #trigger>
      <Button id="sg-dialog-open">Edit exercise</Button>
    </template>
    <TextField id="sg-dialog-edit-name" v-model="name" label="Name" required />
    <div class="flex flex-wrap items-start gap-4">
      <TextField
        id="sg-dialog-edit-sets"
        v-model="sets"
        label="Sets"
        inputmode="numeric"
        class="w-20"
      />
      <SegmentedControl
        id="sg-dialog-edit-measure"
        v-model="measure"
        label="Measure"
        :options="MEASURE"
      />
      <TextField
        id="sg-dialog-edit-reps"
        v-model="reps"
        :label="measure === 'time' ? 'Seconds' : 'Reps'"
        inputmode="numeric"
        class="w-20"
      />
      <SegmentedControl
        id="sg-dialog-edit-reps-count"
        v-model="repsCount"
        :label="measure === 'time' ? 'Timed' : 'Reps count'"
        :options="REPS_COUNT"
      />
    </div>
    <TextField
      id="sg-dialog-edit-weight"
      v-model="weight"
      label="Weight in kg"
      inputmode="decimal"
      placeholder="Bodyweight"
    />
    <Stepper
      id="sg-dialog-edit-target"
      v-model="target"
      label="Times a week"
      lower-label="Fewer times a week"
      raise-label="More times a week"
      :min="0"
      :max="7"
    />
    <template #actions>
      <Button @click="open = false">Cancel</Button>
      <Button variant="primary" @click="open = false">Save</Button>
    </template>
  </Dialog>
</template>
