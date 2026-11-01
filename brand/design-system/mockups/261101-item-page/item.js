// An item's own page, drawn so its layout can be tried in place. IP.mount(el, options) draws the
// page into el and sizes it from el's own box (item.css), so one script draws a scaled desktop,
// a phone and the full-size try page. Options:
//   layout  'a' | 'b' | 'c'       A rows like Settings, B notes beside a side column, C one column
//   item    'exercise' | 'food'   which item the page shows
// The page follows the [data-theme] it sits in. Copy follows voice.md; the marks are the app's
// drawings (marks.js), the icons Lucide (icons.js).
(() => {
  const ICONS = Object.assign({}, window.BAR_ART.icons, {
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
  })
  const I = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`
  const ART = window.FP_ART
  const mark = (kind) => `<span class="mk"${kind ? ` data-mark="${kind}"` : ''}><svg viewBox="0 0 36 36" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${kind ? `<path class="ink" d="${ART.stamp}" fill-rule="evenodd"/><path class="sym" d="${ART.ticks[kind]}" fill="none" stroke-width="3.25"/>` : ''}<path class="bx" d="${ART.box}" stroke-width="1.75"/></svg></span>`

  const g = 'great', p = 'partial', x = 'missed', _ = null
  const ITEMS = {
    exercise: {
      type: 'Exercise',
      name: 'Kettlebell swings',
      chips: ['3 × 15', '16 kg'],
      goal: 3,
      notes: `<p><strong>Hinge, don’t squat.</strong> The hips drive the bell; the arms only guide it.</p>
<ul><li>Brace before each swing</li><li>The bell stops at chest height, no higher</li><li>Breathe out hard at the top</li></ul>
<p>Move to 20 kg once all three sets feel easy. <a href="#">Form video</a></p>`,
      fields: [
        { label: 'Equipment', value: '16 kg kettlebell' },
        { label: 'Works', value: 'Glutes, hamstrings, grip' },
        { label: 'Link', value: 'youtube.com/watch?v=…', link: true },
      ],
      plan: 'exercise',
      weeks: [
        ['26 Oct', [g, _, g, _, _, _, _]],
        ['19 Oct', [g, _, p, _, g, _, _]],
        ['12 Oct', [_, g, _, _, g, _, g]],
        ['5 Oct', [g, _, _, x, _, _, _]],
        ['28 Sep', [_, g, _, g, _, g, _]],
        ['21 Sep', [_, _, _, _, _, _, _]],
        ['14 Sep', [g, _, g, _, _, g, _]],
        ['7 Sep', [_, p, _, _, g, _, _]],
      ],
    },
    food: {
      type: 'Food',
      name: 'Nuts',
      chips: [],
      goal: 3,
      notes: `<p>A handful, not the bag. Unsalted where there’s a choice.</p>
<p>Good with yoghurt in the morning, or on their own after training.</p>`,
      fields: [
        { label: 'A serving', value: 'One handful, about 30 g' },
        { label: 'Examples', value: 'Almonds, walnuts, cashews' },
      ],
      plan: 'food',
      weeks: [
        ['26 Oct', [g, g, _, _, _, _, _]],
        ['19 Oct', [g, _, g, _, g, g, _]],
        ['12 Oct', [_, g, _, _, _, _, g]],
        ['5 Oct', [g, _, g, _, g, _, _]],
        ['28 Sep', [_, _, g, _, _, _, _]],
        ['21 Sep', [g, g, _, g, _, _, _]],
        ['14 Sep', [g, _, _, g, _, g, _]],
        ['7 Sep', [_, g, _, _, g, _, _]],
      ],
    },
  }

  let uid = 0
  const stepper = (id, label, value, min, max) =>
    `<div class="stepper" role="group" aria-labelledby="${id}"><button type="button" aria-label="Fewer" data-step="-1" data-min="${min}"${value <= min ? ' aria-disabled="true"' : ''}>${I('minus')}</button><output class="value" aria-live="polite">${value}</output><button type="button" aria-label="More" data-step="1" data-max="${max}"${value >= max ? ' aria-disabled="true"' : ''}>${I('plus')}</button></div>`
  const field = (id, label, input) => `<div class="ip-field"><label class="ip-label" for="${id}">${label}</label>${input}</div>`
  const text = (id, value, cls = '') => `<input class="tf ${cls}" id="${id}" type="text" value="${value}">`

  function notesBlock(it, id) {
    return `<div class="ip-notes" data-editing="false">
      <div class="note-view note-body">${it.notes}</div>
      <textarea class="ta note-edit" id="${id}-ta" aria-label="Notes" rows="8">${it.notes.replace(/<[^>]+>/g, '').replace(/\n+/g, '\n\n')}</textarea>
      <div class="btns"><button type="button" class="btn" data-notes>${I('pencil')}<span>Edit notes</span></button></div>
    </div>`
  }

  function fieldsBlock(it, id) {
    return `<div class="ip-grid">${it.fields
      .map((f, i) => field(`${id}-f${i}`, f.label, text(`${id}-f${i}`, f.value, f.link ? 'tf-link' : '')))
      .join('')}</div>`
  }

  function planBlock(it, id) {
    const goal = `<div class="ip-field ip-inline"><span class="ip-label" id="${id}-goal">Times a week</span>${stepper(`${id}-goal`, 'Times a week', it.goal, 0, 7)}</div>`
    const lede = `<p class="ip-lede">Changes this week’s plan, and the weeks after it that have no plan of their own.</p>`
    if (it.plan === 'food') return `${lede}<div class="ip-grid">${goal}</div>`
    return `${lede}<div class="ip-grid">
      <div class="ip-field ip-inline"><span class="ip-label" id="${id}-sets">Sets</span>${stepper(`${id}-sets`, 'Sets', 3, 1, 20)}</div>
      <div class="ip-field"><span class="ip-label" id="${id}-measure">Measure</span><div class="seg" role="group" aria-labelledby="${id}-measure"><button type="button" aria-pressed="true">Reps</button><button type="button" aria-pressed="false">Time</button></div></div>
      ${field(`${id}-reps`, 'Reps', `<input class="tf tf-num" id="${id}-reps" inputmode="numeric" value="15">`)}
      ${field(`${id}-kg`, 'Weight in kg', `<input class="tf tf-num" id="${id}-kg" inputmode="decimal" value="16">`)}
      <div class="ip-field"><span class="ip-label" id="${id}-side">Reps count</span><div class="seg" role="group" aria-labelledby="${id}-side"><button type="button" aria-pressed="true">Per set</button><button type="button" aria-pressed="false">Each side</button></div></div>
      ${goal}
    </div>`
  }

  function historyBlock(it) {
    const done = (w) => w[1].filter(Boolean).length
    const met = it.weeks.filter((w) => it.goal > 0 && done(w) >= it.goal).length
    const rows = it.weeks
      .map((w, i) => {
        const n = done(w)
        const ok = it.goal > 0 && n >= it.goal
        return `<li class="wk"${i === 0 ? ' aria-current="date"' : ''}><span class="wk-when">${i === 0 ? 'This week' : w[0]}</span><span class="wk-marks">${w[1].map(mark).join('')}</span><span class="wk-count"${ok ? ' data-met' : ''}>${n} of ${it.goal}</span></li>`
      })
      .join('')
    return `<p class="ip-lede">The goal was met in <strong>${met} of the last ${it.weeks.length} weeks</strong>.</p><ol class="ip-weeks">${rows}</ol>`
  }

  function page(opts) {
    const it = ITEMS[opts.item || 'exercise']
    const id = `ip${++uid}`
    const chips = it.chips.map((c) => `<span class="chip">${c}</span>`).join('')
    const head = `<a class="ip-back" href="#">${I('chevron-left')}<span>Back to the week</span></a>
  <p class="ip-type">${it.type}</p>
  <div class="ip-titleline"><h1 class="ip-title" tabindex="-1">${it.name}</h1>${chips}</div>`
    const sec = (key, title, body) => `<section class="ip-sec" data-sec="${key}" aria-labelledby="${id}-${key}"><h2 id="${id}-${key}">${title}</h2><div class="ip-body">${body}</div></section>`
    const notes = sec('notes', 'Notes', notesBlock(it, id))
    const details = sec('details', 'Details', fieldsBlock(it, id))
    const plan = sec('plan', 'This week’s plan', planBlock(it, id))
    const history = sec('history', 'Recent weeks', historyBlock(it))
    const L = opts.layout || 'a'
    if (L === 'b') return `<main class="ip-page">${head}<div class="ip-cols"><div class="ip-main">${notes}</div><aside class="ip-side" aria-label="About ${it.name}">${plan}${history}${details}</aside></div></main>`
    if (L === 'c') return `<main class="ip-page">${head}${history}${notes}${details}${plan}</main>`
    return `<main class="ip-page">${head}${notes}${details}${plan}${history}</main>`
  }

  function mount(el, opts = {}) {
    el.classList.add('ip')
    el.dataset.layout = opts.layout || 'a'
    el.innerHTML = `<div class="ip-scroll">${page(opts)}</div>`
    el.addEventListener('click', (e) => {
      if (e.target.closest('a')) e.preventDefault()
      const seg = e.target.closest('.seg button')
      if (seg) seg.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === seg)))
      const step = e.target.closest('[data-step]')
      if (step && step.getAttribute('aria-disabled') !== 'true') {
        const grp = step.parentElement
        const out = grp.querySelector('.value')
        const lo = Number(grp.querySelector('[data-min]').dataset.min), hi = Number(grp.querySelector('[data-max]').dataset.max)
        const v = Math.min(hi, Math.max(lo, Number(out.textContent) + Number(step.dataset.step)))
        out.textContent = v
        grp.querySelector('[data-min]').toggleAttribute('aria-disabled', v <= lo)
        grp.querySelector('[data-max]').toggleAttribute('aria-disabled', v >= hi)
      }
      const nb = e.target.closest('[data-notes]')
      if (nb) {
        const box = nb.closest('.ip-notes')
        const editing = box.dataset.editing !== 'true'
        box.dataset.editing = String(editing)
        nb.innerHTML = editing ? `${I('check')}<span>Done</span>` : `${I('pencil')}<span>Edit notes</span>`
        if (editing) box.querySelector('textarea').focus()
      }
    })
  }
  window.IP = { mount }
})()
