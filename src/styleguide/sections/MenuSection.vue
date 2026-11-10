<script setup lang="ts">
import { CircleUserRound, LogOut, UserRound } from '@lucide/vue'
import { BarAction } from '@/components/ui/bar-action'
import { Menu, MenuItem } from '@/components/ui/menu'
import StateExample from '../parts/StateExample.vue'
</script>

<!-- The card's account menu (components/Menu/preview.html) under its BarAction, at the end of a
     stand-in Header. Pressing it shows the Open state; the pointer or the arrow keys show the
     highlight, and the keyboard the focus ring. The items go nowhere here. The id sits on a wrapper:
     the menu gives its trigger the id that names the panel. -->
<template>
  <StateExample state="Closed (press it to open; arrow keys move, Escape closes)">
    <div id="sg-menu-account-closed" class="flex w-full justify-end">
      <Menu header-caption="Signed in as" header="alex@example.com">
        <template #trigger>
          <BarAction label="Profile"><CircleUserRound /></BarAction>
        </template>
        <MenuItem>
          <template #icon><UserRound /></template>
          Profile
        </MenuItem>
        <MenuItem>
          <template #icon><LogOut /></template>
          Sign out
        </MenuItem>
      </Menu>
    </div>
  </StateExample>
</template>
