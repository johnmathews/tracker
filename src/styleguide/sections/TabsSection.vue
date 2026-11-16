<script setup lang="ts">
import { ref } from 'vue'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import ExampleGroup from '../parts/ExampleGroup.vue'
import StateExample from '../parts/StateExample.vue'

// The Settings page's tabs (K119), with the first line of each section.
const TABS = [
  {
    value: 'appearance',
    label: 'Appearance',
    text: 'Marks, then Theme. Both are this device’s.',
  },
  {
    value: 'daily-goal',
    label: 'Daily goal',
    text: 'How many exercises and foods to mark each day. A day that reaches it turns green.',
  },
  {
    value: 'data',
    label: 'Your data',
    text: 'Export saves everything to a file. Import adds a file’s plans and marks to yours.',
  },
  {
    value: 'connections',
    label: 'Connections',
    text: 'Let Claude or ChatGPT read your weeks and, if you allow it, mark days and edit your plans.',
  },
]

const open = ref('appearance')
const openFocus = ref('data')
const openPhone = ref('connections')
</script>

<!-- The card's states (components/Tabs/preview.html). Hover cannot be forced, so it is left to the
     pointer. The phone state is held to the card's narrow width, where the tabs wrap. -->
<template>
  <ExampleGroup>
    <StateExample state="Appearance open (press or arrow to another tab)">
      <Tabs id="sg-tabs-settings-default" v-model="open">
        <TabsList aria-label="Settings">
          <TabsTrigger v-for="t in TABS" :key="t.value" :value="t.value">
            {{ t.label }}
          </TabsTrigger>
        </TabsList>
        <TabsContent v-for="t in TABS" :key="t.value" :value="t.value" class="pt-6">
          <h3 class="title-2 text-ink">{{ t.label }}</h3>
          <p class="body mt-2 max-w-[60ch] text-ink-secondary">{{ t.text }}</p>
        </TabsContent>
      </Tabs>
    </StateExample>
    <StateExample state="Focus (Tab to it): Your data open">
      <Tabs id="sg-tabs-settings-focus" v-model="openFocus">
        <TabsList aria-label="Settings, focus">
          <TabsTrigger v-for="t in TABS" :key="t.value" :value="t.value">
            {{ t.label }}
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </StateExample>
    <StateExample state="On a phone: Connections open, wrapped onto two lines">
      <Tabs id="sg-tabs-settings-phone" v-model="openPhone" class="max-w-[340px]">
        <TabsList aria-label="Settings, on a phone">
          <TabsTrigger v-for="t in TABS" :key="t.value" :value="t.value">
            {{ t.label }}
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </StateExample>
  </ExampleGroup>
</template>
