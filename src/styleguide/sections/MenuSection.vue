<script setup lang="ts">
import { CircleUserRound, Ellipsis, EyeOff, LogOut, RefreshCw, UserRound } from '@lucide/vue'
import { BarAction } from '@/components/ui/bar-action'
import { IconButton } from '@/components/ui/icon-button'
import { Menu, MenuItem } from '@/components/ui/menu'
import StateExample from '../parts/StateExample.vue'
</script>

<!-- The card's account menu (components/Menu/preview.html) under its BarAction, at the end of a
     stand-in Header, then a row's More menu (K171) under its IconButton at the end of a stand-in
     library row. Pressing either shows the Open state; the pointer or the arrow keys show the
     highlight, and the keyboard the focus ring. The items go nowhere here. Each id sits on a
     wrapper: the menu gives its trigger the id that names the panel. -->
<template>
  <div class="flex flex-col gap-8">
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
    <StateExample state="On a list row: More, after the row's own buttons, with no header">
      <div
        id="sg-menu-row-closed"
        class="flex w-full max-w-120 flex-col gap-2 border-y border-line py-3"
      >
        <span class="body font-semibold">Couch to 5K</span>
        <div class="flex justify-end">
          <Menu>
            <template #trigger>
              <IconButton label="More for Couch to 5K"><Ellipsis /></IconButton>
            </template>
            <MenuItem>
              <template #icon><RefreshCw /></template>
              Publish again
            </MenuItem>
            <MenuItem>
              <template #icon><EyeOff /></template>
              Unpublish
            </MenuItem>
          </Menu>
        </div>
      </div>
    </StateExample>
  </div>
</template>
