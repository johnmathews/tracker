<!--
  The work charts' legend (WorkChart card, K180), in caption ink-secondary: Planned (a 1.5px
  ink-secondary outline), Still to come (a dashed control-border outline) and Done (pen). The
  swatches are hidden from a screen reader; the words stay.
-->
<template>
  <ul
    class="m-0 flex list-none flex-wrap gap-x-5 gap-y-1 p-0 text-(length:--set-caption) leading-[1.4] text-ink-secondary"
    data-testid="work-chart-legend"
  >
    <li class="inline-flex items-center gap-2">
      <span
        class="inline-block h-3 w-[18px] rounded-[2px] border-[1.5px] border-ink-secondary"
        aria-hidden="true"
      />
      Planned
    </li>
    <li class="inline-flex items-center gap-2">
      <span
        class="inline-block h-3 w-[18px] rounded-[2px] border-[1.5px] border-dashed border-control-border"
        aria-hidden="true"
      />
      Still to come
    </li>
    <li class="inline-flex items-center gap-2">
      <span class="inline-block h-3 w-[18px] rounded-[2px] bg-pen" aria-hidden="true" />
      Done
    </li>
  </ul>
</template>
