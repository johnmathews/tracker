<script setup lang="ts">
import { onMounted, ref, useId, useTemplateRef } from 'vue'
import { ChevronLeft, LogOut } from '@lucide/vue'
import { usePlannerStore } from '@/stores/planner'
import { useSessionStore } from '@/stores/session'
import { MAX_GOALS, MAX_LIMITS, normaliseGoals, normaliseLimits } from '@/lib/storage'
import { useNoteDraft } from '@/composables/noteDraft'
import { useSignOut } from '@/composables/signOut'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { InlineMessage } from '@/components/ui/inline-message'
import { TextArea } from '@/components/ui/text-area'
import { TextLink } from '@/components/ui/text-link'

const store = usePlannerStore()
const session = useSessionStore()
const heading = useTemplateRef<HTMLHeadingElement>('heading')
const signOutButton = useTemplateRef<InstanceType<typeof Button>>('signOutButton')
const ids = { account: useId(), goals: useId(), limits: useId() }

// Arriving here moves focus to the page's heading, so a screen reader starts at the top.
onMounted(() => heading.value!.focus())

/** My goals and Your limits (K107): each box saves when typing pauses (F18). */
const goals = useNoteDraft({
  saved: () => store.goals,
  known: () => store.goalsKnown,
  set: (text) => store.setGoals(text),
  normalise: normaliseGoals,
})
const limits = useNoteDraft({
  saved: () => store.limits,
  known: () => store.limitsKnown,
  set: (text) => store.setLimits(text),
  normalise: normaliseLimits,
})

const signOut = useSignOut()
const signOutProblem = ref<string | null>(null)
async function startSignOut(): Promise<void> {
  signOutProblem.value = await signOut.start()
}
/** The Sign out button, where focus returns once the sign-out question closes. */
function signOutTarget(): HTMLElement | null {
  return (signOutButton.value?.$el as HTMLElement | undefined) ?? null
}
</script>

<!--
  The Profile page (brand/design-system/project/components/ProfilePage, K106), at #/profile, on
  the SettingsPage's frame and with no Header: a link back to the week, the heading, then
  Account (who is signed in, Sign out), Your goals and Your limits (K107). Each note saves when
  typing pauses; there is no Save.
-->
<template>
  <div
    class="flex flex-col pt-[calc(var(--u)*28)] pb-[calc(var(--u)*64)]"
    data-slot="profile-page"
    data-testid="profile-page"
    data-noprint
  >
    <TextLink
      href="#/"
      class="inline-flex items-center gap-1.5 self-start text-(length:--set-text) [&_svg]:size-(--set-icon)"
      ><ChevronLeft :stroke-width="1.5" aria-hidden="true" />Back to the week</TextLink
    >
    <h1
      ref="heading"
      tabindex="-1"
      class="title-1 mt-[calc(var(--u)*12)] mb-[calc(var(--u)*28)] text-(length:--fs-title) leading-tight text-ink focus:outline-none"
    >
      Profile
    </h1>

    <section
      :aria-labelledby="ids.account"
      class="grid grid-cols-[var(--grid-name-w)_minmax(0,1fr)] items-start border-t border-line py-(--set-sec-y) folded:flex folded:flex-col folded:items-stretch folded:gap-4"
    >
      <h2 :id="ids.account" class="title-2 text-(length:--set-h2) leading-tight text-ink">
        Account
      </h2>
      <div class="flex min-w-0 flex-col gap-(--set-gap)">
        <div class="flex flex-wrap items-center gap-x-(--set-gap) gap-y-3">
          <p
            class="body min-w-0 text-(length:--set-text) leading-normal break-words text-ink-secondary"
            data-testid="signed-in-as"
          >
            Signed in as <span class="font-semibold text-ink">{{ session.user }}</span>
          </p>
          <Button ref="signOutButton" @click="startSignOut"
            ><LogOut :stroke-width="1.5" />Sign out</Button
          >
        </div>
        <InlineMessage v-if="signOutProblem" tone="error" data-testid="sign-out-problem">
          {{ signOutProblem }}
        </InlineMessage>
      </div>
    </section>

    <section
      :aria-labelledby="ids.goals"
      class="grid grid-cols-[var(--grid-name-w)_minmax(0,1fr)] items-start border-t border-line py-(--set-sec-y) folded:flex folded:flex-col folded:items-stretch folded:gap-4"
    >
      <h2 :id="ids.goals" class="title-2 text-(length:--set-h2) leading-tight text-ink">
        Your goals
      </h2>
      <TextArea
        v-model="goals.draft.value"
        label="What you’re working towards"
        hint="Ask and your Claude connections read this. Nothing else does."
        rows="4"
        :maxlength="MAX_GOALS"
        :disabled="!goals.editable.value"
        class="max-w-[calc(var(--u)*900)] min-w-0"
        data-testid="goals"
        @input="goals.onInput"
        @blur="goals.commit"
      />
    </section>

    <section
      :aria-labelledby="ids.limits"
      class="grid grid-cols-[var(--grid-name-w)_minmax(0,1fr)] items-start border-t border-line py-(--set-sec-y) folded:flex folded:flex-col folded:items-stretch folded:gap-4"
    >
      <h2 :id="ids.limits" class="title-2 text-(length:--set-h2) leading-tight text-ink">
        Your limits
      </h2>
      <TextArea
        v-model="limits.draft.value"
        label="What you have to work around"
        hint="Injuries, equipment, time and food. Ask and your Claude connections read this too."
        rows="4"
        :maxlength="MAX_LIMITS"
        :disabled="!limits.editable.value"
        class="max-w-[calc(var(--u)*900)] min-w-0"
        data-testid="limits"
        @input="limits.onInput"
        @blur="limits.commit"
      />
    </section>

    <ConfirmDialog
      v-model:open="signOut.asking.value"
      title="Sign out now?"
      :message="signOut.message.value"
      confirm-label="Sign out"
      :busy="signOut.busy.value"
      :error="signOut.error.value"
      :return-focus="signOutTarget"
      @confirm="signOut.confirm"
    />
  </div>
</template>
