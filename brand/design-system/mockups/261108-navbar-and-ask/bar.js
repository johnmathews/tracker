// The bar in Edit plan, drawn into any element: NB.mount(el, { week: 'a' | 'b', other, done, focus }).
//   week   'a' | 'b'   the week's type: A the serif title; B the bar's sans, bolder
//   other  true        another week is on screen, so "This week" shows after the arrows
//   done   true        K2: a "Done" action ends the actions
//   focus  true        K1: "Done editing" has keyboard focus, shown over the start of the bar
// The icons are Lucide's (@lucide/vue), as the app draws them.
(() => {
  const P = {
    'chevron-left': '<path d="m15 18-6-6 6-6"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
    'message-circle': '<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/>',
    settings: '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>',
    printer: '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
    maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    minus: '<path d="M5 12h14"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  }
  const I = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]}</svg>`
  const act = (name, icon, extra = '') => `<button type="button" class="nb-act"${extra}>${I(icon)}<span class="name">${name}</span></button>`

  function mount(el, o = {}) {
    el.classList.add('nb')
    el.dataset.week = o.week || 'a'
    if (o.focus) el.dataset.focus = ''
    const phone = o.phone
    const actions = [
      o.other ? act('This week', 'calendar') : '',
      act('Ask', 'message-circle'),
      act('Settings', 'settings'),
      phone ? '' : act('Print…', 'printer'),
      phone ? '' : act('Full screen', 'maximize'),
      o.done ? act('Done', 'check', ' data-done') : '',
    ].join('')
    el.innerHTML = `<div class="nb-in">
  <header class="nb-bar">
    <a class="nb-skip" href="#">Done editing</a>
    <nav class="nb-week" aria-label="Week">
      <button type="button" class="nb-arrow" aria-label="Previous week">${I('chevron-left')}</button>
      <p class="nb-label">${o.other ? '26 Oct–1 November' : '2–8 November'}</p>
      <button type="button" class="nb-arrow" aria-label="Next week">${I('chevron-right')}</button>
    </nav>
    <div class="nb-actions">${actions}</div>
  </header>
  <div class="nb-page">
    <div class="nb-title"><h2>Exercises</h2><span class="nb-step">${I('minus').replace('<svg', '<svg width="18" height="18"')}3 per day${I('plus').replace('<svg', '<svg width="18" height="18"')}</span></div>
    <div class="nb-days"><span class="nb-name"></span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div>
  </div>
</div>`
  }
  window.NB = { mount }
})()
