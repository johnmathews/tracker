// Draws the mockup's frames. <div data-pf="bar" data-opt="a|b" [data-open] [data-phone]> is the bar in
// Edit plan with the profile button (A: a BarAction "Profile"; B: the initial in a ring) and, open,
// its menu. <div data-pf="page"> is the Profile page. Icons are Lucide's (@lucide/vue 1.61), as the
// app draws them.
(() => {
  const P = {
    'chevron-left': '<path d="m15 18-6-6 6-6"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    'message-circle': '<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/>',
    settings: '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>',
    printer: '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
    maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
    'circle-user-round': '<path d="M17.925 20.056a6 6 0 0 0-11.851.001"/><circle cx="12" cy="11" r="4"/><circle cx="12" cy="12" r="10"/>',
    'user-round': '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
    'log-out': '<path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>',
  }
  const I = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]}</svg>`
  const act = (name, icon, extra = '') => `<button type="button" class="pf-act"${extra}>${I(icon)}<span class="name">${name}</span></button>`
  const EMAIL = 'alex@example.com'

  const menu = (id) => `<div class="pf-menu" role="menu" id="${id}" aria-label="Profile">
    <p class="pf-who"><span class="caption">Signed in as</span><span class="addr">${EMAIL}</span></p>
    <ul class="pf-items" role="none">
      <li role="none"><button type="button" class="pf-item" role="menuitem" data-hl>${I('user-round')}Profile</button></li>
      <li role="none"><button type="button" class="pf-item" role="menuitem">${I('log-out')}Sign out</button></li>
    </ul>
  </div>`

  let n = 0
  function bar(el) {
    const opt = el.dataset.opt || 'a'
    const open = 'open' in el.dataset
    const phone = 'phone' in el.dataset
    const id = `pf-menu-${++n}`
    const exp = ` aria-haspopup="menu" aria-expanded="${open}" aria-controls="${id}"`
    const profile = opt === 'a'
      ? act('Profile', 'circle-user-round', exp)
      : `<span class="pf-sep" aria-hidden="true"></span><button type="button" class="pf-avatar" aria-label="Profile"${exp}>A</button>`
    el.innerHTML = `<div class="pf-in">
  <header class="pf-bar">
    <nav class="pf-week" aria-label="Week">
      <button type="button" class="pf-arrow" aria-label="Previous week">${I('chevron-left')}</button>
      <p class="pf-label">9–15 November</p>
      <button type="button" class="pf-arrow" aria-label="Next week">${I('chevron-right')}</button>
    </nav>
    <div class="pf-actions">
      ${act('Ask', 'message-circle')}${act('Settings', 'settings')}
      ${phone ? '' : act('Print…', 'printer') + act('Full screen', 'maximize')}
      ${profile}
      ${open ? menu(id) : ''}
    </div>
  </header>
  <div class="pf-under">
    <h2>Exercises</h2>
    <div class="pf-days"><span class="pf-name"></span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div>
  </div>
</div>`
    // A press on the profile button opens and closes the menu, as it will in the app.
    el.querySelector('[aria-haspopup]').addEventListener('click', () => {
      if ('open' in el.dataset) delete el.dataset.open
      else el.dataset.open = ''
      bar(el)
      el.querySelector('[aria-haspopup]').focus()
    })
  }

  const GOALS = 'Run 5 km in under 25 minutes by March. Keep two strength days a week. Eat more protein at breakfast.'
  const LIMITS = 'Left knee: no jumping and no deep squats. Dumbbells up to 20 kg at home; the gym only on Saturdays. 40 minutes on weekdays. Vegetarian.'

  function page(el) {
    el.innerHTML = `<div class="pf-in"><div class="pf-page">
  <a class="pf-back" href="#">${I('chevron-left')}Back to the week</a>
  <h1 class="pf-title">Profile</h1>
  <section class="pf-sec" aria-label="Account">
    <h2>Account</h2>
    <div class="pf-row">
      <p class="pf-lede">Signed in as <b>${EMAIL}</b></p>
      <button type="button" class="pf-btn">${I('log-out')}Sign out</button>
    </div>
  </section>
  <section class="pf-sec" aria-label="Your goals">
    <h2>Your goals</h2>
    <div class="pf-field">
      <label>What you’re working towards</label>
      <textarea rows="4">${GOALS}</textarea>
      <p class="pf-hint"><span class="count">${GOALS.length} / 1,000</span>Ask and your Claude connections read this. Nothing else does.</p>
    </div>
  </section>
  <section class="pf-sec" aria-label="Your limits">
    <h2>Your limits</h2>
    <div class="pf-field">
      <label>What you have to work around</label>
      <textarea rows="4">${LIMITS}</textarea>
      <p class="pf-hint"><span class="count">${LIMITS.length} / 1,000</span>Injuries, equipment, time and food. Ask and your Claude connections read this too.</p>
    </div>
  </section>
</div></div>`
  }

  for (const el of document.querySelectorAll('[data-pf]')) {
    el.classList.add('pf')
    if (el.dataset.pf === 'bar') bar(el)
    else page(el)
  }
})()
