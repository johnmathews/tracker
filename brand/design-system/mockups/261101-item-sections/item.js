// The item page in layout A (K65), with a way to choose which sections show and in what order.
// IP.mount(el, options) draws into el and sizes from el's own box (item.css, arrange.css).
// Options:
//   option  'a' | 'b' | 'c'       A arrange in place, B a Sections dialog, C a row on Settings
//   item    'exercise' | 'food'
//   state   'page' | 'arranging'  the page as it reads, or with the arranging open
// The page follows the [data-theme] it sits in. Copy follows voice.md; marks are the app's
// drawings (marks.js), icons Lucide (icons.js). Everything works: switches, moves, Done.
(() => {
  const ICONS = Object.assign({}, window.BAR_ART.icons, {
    check: '<path d="M20 6 9 17l-5-5"/>',
    'arrow-up': '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
    'arrow-down': '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
    list: '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
  })
  const I = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`
  const ART = window.FP_ART
  const mark = (kind) => `<span class="mk"${kind ? ` data-mark="${kind}"` : ''}><svg viewBox="0 0 36 36" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${kind ? `<path class="ink" d="${ART.stamp}" fill-rule="evenodd"/><path class="sym" d="${ART.ticks[kind]}" fill="none" stroke-width="3.25"/>` : ''}<path class="bx" d="${ART.box}" stroke-width="1.75"/></svg></span>`

  const g = 'great', p = 'partial', x = 'missed', _ = null
  const ITEMS = {
    exercise: {
      type: 'Exercise', plural: 'exercise', name: 'Push-ups', chips: ['3 × 12'], goal: 4,
      notes: '<p>Slow on the way down. <a href="#">Form video</a></p>',
      fields: [['Equipment', ''], ['Works', 'Chest, triceps'], ['Link', '']],
      weeks: [['This week', [g, x, g, x, g, p, x]], ['19 Oct', [g, g, g, p, g, g, _]], ['12 Oct', [g, g, g, g, g, g, _]], ['5 Oct', [g, _, g, _, g, _, _]]],
    },
    food: {
      type: 'Food', plural: 'food', name: 'Fish', chips: [], goal: 2,
      notes: '<p>Salmon or mackerel. Tinned counts.</p>',
      fields: [['A serving', 'One fillet'], ['Examples', 'Salmon, mackerel, sardines']],
      weeks: [['This week', [_, g, _, _, _, _, _]], ['19 Oct', [g, _, _, g, _, _, _]], ['12 Oct', [_, _, g, _, _, _, _]], ['5 Oct', [g, _, _, _, g, _, _]]],
    },
  }
  const TITLES = { notes: 'Notes', details: 'Details', plan: 'This week’s plan', history: 'Recent weeks' }

  let uid = 0
  const field = (id, label, input) => `<div class="ip-field"><label class="ip-label" for="${id}">${label}</label>${input}</div>`
  const text = (id, value, cls = '') => `<input class="tf ${cls}" id="${id}" type="text" value="${value}">`
  const stepper = (id, value) => `<div class="stepper" role="group" aria-labelledby="${id}"><button type="button" aria-label="Fewer times a week">${I('minus')}</button><output class="value">${value}</output><button type="button" aria-label="More times a week">${I('plus')}</button></div>`

  function body(key, it, id) {
    if (key === 'notes') return `<div class="note-body">${it.notes}</div><div class="btns"><button type="button" class="btn">${I('pencil')}<span>Edit notes</span></button></div>`
    if (key === 'details') return `<div class="ip-grid">${it.fields.map(([l, v], i) => field(`${id}-f${i}`, l, text(`${id}-f${i}`, v))).join('')}</div>`
    if (key === 'plan') {
      const goal = `<div class="ip-field"><span class="ip-label" id="${id}-goal">Times a week</span>${stepper(`${id}-goal`, it.goal)}</div>`
      const lede = '<p class="ip-lede">Changes this week’s plan, and the weeks after it that have no plan of their own.</p>'
      if (it.plural === 'food') return `${lede}<div class="ip-grid">${goal}</div>`
      return `${lede}<div class="ip-grid">${field(`${id}-sets`, 'Sets', `<input class="tf tf-num" id="${id}-sets" value="3">`)}
        <div class="ip-field"><span class="ip-label">Measure</span><div class="seg" role="group"><button type="button" aria-pressed="true">Reps</button><button type="button" aria-pressed="false">Time</button></div></div>
        ${field(`${id}-reps`, 'Reps', `<input class="tf tf-num" id="${id}-reps" value="12">`)}${goal}</div>`
    }
    const rows = it.weeks.map(([w, m], i) => {
      const n = m.filter(Boolean).length
      return `<li class="wk"${i === 0 ? ' aria-current="date"' : ''}><span class="wk-when">${w}</span><span class="wk-marks">${m.map(mark).join('')}</span><span class="wk-count"${n >= it.goal ? ' data-met' : ''}>${n} of ${it.goal}</span></li>`
    }).join('')
    return `<p class="ip-lede">The goal was met in <strong>three of the last four weeks</strong>.</p><ol class="ip-weeks">${rows}</ol>`
  }

  // The arranging controls for one section: a Switch to show it, then Move up and Move down.
  function controls(key, i, n, shown) {
    const t = TITLES[key]
    return `<div class="ar-ctl"><button type="button" class="sw" role="switch" aria-checked="${shown}" data-toggle="${key}"><span class="sw-track" aria-hidden="true"><span class="sw-thumb"></span></span><span class="sw-label">Show</span><span class="vh"> ${t}</span></button>
      <button type="button" class="ib" data-move="-1" data-key="${key}" aria-label="Move ${t} up"${i === 0 ? ' aria-disabled="true"' : ''}>${I('arrow-up')}</button>
      <button type="button" class="ib" data-move="1" data-key="${key}" aria-label="Move ${t} down"${i === n - 1 ? ' aria-disabled="true"' : ''}>${I('arrow-down')}</button></div>`
  }

  // The list the dialog (B) and Settings (C) use: one row per section.
  function list(st, scopeWords) {
    const rows = st.order.map((k, i) => `<li class="ar-row" data-shown="${!st.hidden.has(k)}"><span class="ar-name">${TITLES[k]}</span>${controls(k, i, st.order.length, !st.hidden.has(k))}</li>`).join('')
    return `<p class="ip-lede">${scopeWords}</p><ol class="ar-list">${rows}</ol>`
  }

  function head(it, opt, st) {
    const chips = it.chips.map((c) => `<span class="chip">${c}</span>`).join('')
    const arrange = opt === 'c' ? '' : `<button type="button" class="btn btn-quiet ar-open" data-arrange aria-pressed="${st.arranging}">${I(st.arranging && opt === 'a' ? 'check' : 'list')}<span>${st.arranging && opt === 'a' ? 'Done' : 'Arrange sections'}</span></button>`
    return `<div class="ip-topline"><a class="ip-back" href="#">${I('chevron-left')}<span>Back to the week</span></a>${arrange}</div>
  <p class="ip-type">${it.type}</p>
  <div class="ip-titleline"><h1 class="ip-title" tabindex="-1">${it.name}</h1>${chips}</div>`
  }

  function itemPage(it, opt, st) {
    const id = `ip${++uid}`
    const shown = st.order.filter((k) => !st.hidden.has(k))
    let sections
    if (opt === 'a' && st.arranging) {
      const lede = `<p class="ip-lede ar-lede">Choose which sections every ${it.plural} page shows, and their order. Changes apply at once.</p>`
      sections = lede + st.order.map((k, i) => {
        const on = !st.hidden.has(k)
        return `<section class="ip-sec ar-sec" data-shown="${on}" aria-labelledby="${id}-${k}"><div class="ar-head"><h2 id="${id}-${k}">${TITLES[k]}</h2>${controls(k, i, st.order.length, on)}</div><div class="ip-body">${on ? `<p class="ar-summary">Shown</p>` : '<p class="ar-summary">Hidden</p>'}</div></section>`
      }).join('')
    } else {
      sections = shown.map((k) => `<section class="ip-sec" aria-labelledby="${id}-${k}"><h2 id="${id}-${k}">${TITLES[k]}</h2><div class="ip-body">${body(k, it, id)}</div></section>`).join('')
    }
    let dialog = ''
    if (opt === 'b' && st.arranging) {
      dialog = `<div class="scrim"></div><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="${id}-dt"><h2 id="${id}-dt" class="dlg-title">Sections</h2>${list(st, `Choose which sections every ${it.plural} page shows, and their order.`)}<div class="btns dlg-btns"><button type="button" class="btn btn-primary" data-arrange>Done</button></div></div>`
    }
    return `<main class="ip-page">${head(it, opt, st)}${sections}</main>${dialog}`
  }

  // C: the same list as a row on the Settings page, for each type.
  function settingsPage(st) {
    const id = `sp${++uid}`
    return `<main class="ip-page"><div class="ip-topline"><a class="ip-back" href="#">${I('chevron-left')}<span>Back to the week</span></a></div>
      <div class="ip-titleline"><h1 class="ip-title" tabindex="-1">Settings</h1></div>
      <section class="ip-sec" aria-labelledby="${id}-look"><h2 id="${id}-look">Appearance</h2><div class="ip-body"><div class="ip-field"><span class="ip-label">Theme</span><div class="seg" role="group"><button type="button" aria-pressed="true">System</button><button type="button" aria-pressed="false">Light</button><button type="button" aria-pressed="false">Dark</button></div></div></div></section>
      <section class="ip-sec" aria-labelledby="${id}-items"><h2 id="${id}-items">Item pages</h2><div class="ip-body">
        <div class="ip-field"><span class="ip-label">Exercises</span>${list(st.exercise, 'The sections an exercise’s page shows, in order.')}</div>
        <div class="ip-field"><span class="ip-label">Food</span>${list(st.food, 'The sections a food’s page shows, in order.')}</div>
      </div></section>
      <section class="ip-sec" aria-labelledby="${id}-data"><h2 id="${id}-data">Your data</h2><div class="ip-body"><p class="ip-lede">Export saves everything to a file. Import adds a file’s plans and marks to yours and never deletes anything.</p></div></section></main>`
  }

  const fresh = () => ({ order: ['notes', 'details', 'plan', 'history'], hidden: new Set(['details']), arranging: false })

  function mount(el, opts = {}) {
    el.classList.add('ip')
    el.dataset.layout = 'a'
    const opt = opts.option || 'a'
    const it = ITEMS[opts.item || 'exercise']
    const st = opt === 'c' ? { exercise: fresh(), food: fresh() } : fresh()
    if (opt !== 'c') st.arranging = opts.state === 'arranging'
    const draw = () => {
      const scroll = el.querySelector('.ip-scroll')
      const top = scroll ? scroll.scrollTop : 0
      el.innerHTML = `<div class="ip-scroll">${opt === 'c' ? settingsPage(st) : itemPage(it, opt, st)}</div>`
      el.querySelector('.ip-scroll').scrollTop = top
    }
    draw()
    el.addEventListener('click', (e) => {
      if (e.target.closest('a')) e.preventDefault()
      const s = opt === 'c' ? st[e.target.closest('.ip-field')?.querySelector('.ip-label')?.textContent === 'Food' ? 'food' : 'exercise'] : st
      if (e.target.closest('[data-arrange]')) { st.arranging = !st.arranging; draw(); return }
      const tg = e.target.closest('[data-toggle]')
      if (tg) { const k = tg.dataset.toggle; if (s.hidden.has(k)) s.hidden.delete(k); else s.hidden.add(k); draw(); return }
      const mv = e.target.closest('[data-move]')
      if (mv && mv.getAttribute('aria-disabled') !== 'true') {
        const i = s.order.indexOf(mv.dataset.key), j = i + Number(mv.dataset.move)
        ;[s.order[i], s.order[j]] = [s.order[j], s.order[i]]
        draw()
      }
    })
  }
  window.IP = { mount }
})()
