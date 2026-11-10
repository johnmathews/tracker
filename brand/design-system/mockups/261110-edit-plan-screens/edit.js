// Edit plan as screens, drawn into any element: EP.mount(el, { o, at }).
//   o   'a' | 'b' | 'now'   A: the week's screens under the bar; B: screens with Edit plan's own
//                           rows, from the top; now: today's Edit plan, one long page
//   at  'cardio'            start scrolled to the Cardio screen
(() => {
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const EXERCISES = ['Exercises', 'exercise', 3, [
    ['Push-ups', '3 × 12', [1, 0, 1, 0, 0, 0, 0]],
    ['Squats', '3 × 15', [0, 1, 1, 0, 0, 0, 0]],
    ['Plank', '3 × 45 s', [1, 0, 0, 0, 0, 0, 0]],
    ['Kettlebell halos', '8 each side', [0, 0, 1, 0, 0, 0, 0]],
    ['Pull-ups', '3 × 5', [1, 1, 0, 0, 0, 0, 0]],
  ]]
  const CARDIO = ['Cardio', 'cardio', 0, [
    ['Cycling', '30 min', [1, 0, 0, 0, 0, 0, 0]],
    ['Running', '5 km', [0, 0, 1, 0, 0, 0, 0]],
  ]]
  const FOOD = ['Food', 'food', 2, [
    ['Vegetables', '2 portions', [1, 1, 1, 0, 0, 0, 0]],
    ['Fruit', '2 pieces', [1, 0, 1, 0, 0, 0, 0]],
    ['Fish', '', [0, 0, 1, 0, 0, 0, 0]],
    ['Nuts', '', [1, 1, 0, 0, 0, 0, 0]],
  ]]
  const pencil = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.17 6.81a1 1 0 0 0-3.98-3.98L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5zM15 5l4 4"/></svg>'
  const trash = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>'
  const chevron = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d === 'up' ? 'm18 15-6-6-6 6' : 'm6 9 6 6 6-6'}"/></svg>`
  const icon = (paths) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`
  const gear = icon('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>')
  const printer = icon('<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/>')
  const full = icon('<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>')

  function grid(rows) {
    const head = DAYS.map((d) => `<div class="ep-head">${d}</div>`).join('') + '<div class="ep-head"></div>'
    const body = rows.map(([n, c, m]) =>
      `<div class="ep-name"><span>${n}</span><span class="ep-icon">${pencil}</span>${c ? `<span class="ep-chip">${c}</span>` : ''}</div>` +
      m.map((x) => `<div class="ep-cell"><span class="ep-box${x ? ' on' : ''}"></span></div>`).join('') +
      `<div class="ep-cell"><span class="ep-icon">${trash}</span></div>`).join('')
    return `<div class="ep-grid" style="--n: ${rows.length}"><div class="ep-corner"></div>${head}${body}</div>`
  }
  function mount(el, o = {}) {
    el.classList.add('ep')
    el.dataset.o = o.o || 'a'
    const screensOn = el.dataset.o !== 'now'
    const list = [EXERCISES, CARDIO, FOOD]
    const sections = list.map(([title, kind, pick, rows], i) => {
      const next = list[i + 1], back = list[i - 1]
      const up = screensOn && back ? `<span class="ep-arrow ep-up" title="Back to ${back[0]}">${chevron('up')}</span>` : ''
      const down = screensOn && next ? `<span class="ep-arrow ep-down" title="Go to ${next[0]}">${chevron('down')}</span>` : ''
      const target = pick ? `<span class="ep-stepper"><b>−</b><span>${pick} per day</span><b>+</b></span>` : ''
      return `<section class="ep-screen">${up}<div class="ep-title"><h2 class="ep-sec">${title}</h2>${target}</div>` +
        `${grid(rows)}<div class="ep-foot"><span class="ep-add">+ Add ${kind}</span>${down}</div></section>`
    }).join('')
    const bar = `<header class="ep-bar"><span class="ep-week"><i>${chevron('down')}</i>9–15 November<i>${chevron('down')}</i></span>` +
      `<span class="ep-actions"><span>${gear}Settings</span><span>${printer}Print…</span><span>${full}Full screen</span></span></header>`
    el.innerHTML = `<div class="ep-scroll" tabindex="0" aria-label="Edit plan, scrollable">${bar}${sections}</div>`
    const scroller = el.firstElementChild
    for (const a of scroller.querySelectorAll('.ep-arrow')) {
      a.addEventListener('click', () => {
        const screens = [...scroller.querySelectorAll('.ep-screen')]
        const at = screens.indexOf(a.closest('.ep-screen'))
        const to = screens[at + (a.classList.contains('ep-up') ? -1 : 1)]
        scroller.scrollTo({ top: to.offsetTop - scroller.querySelector('.ep-bar').offsetHeight, behavior: 'smooth' })
      })
    }
    if (o.at === 'cardio') requestAnimationFrame(() => {
      const c = scroller.querySelectorAll('.ep-screen')[1]
      scroller.scrollTop = c.offsetTop - scroller.querySelector('.ep-bar').offsetHeight
    })
  }
  window.EP = { mount }
})()
