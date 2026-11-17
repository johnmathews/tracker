// Programmes, as a live prototype. PG.mount(el, options) draws one screen into el and sizes it
// from el's own box (proto.css). The same code draws the scaled frames on the mockup page and the
// full-size try.html. Options:
//   screen   'overview' | 'change' | 'activity' | 'week'
//   q1       'a' | 'b' | 'c'      the overview: table, timeline, or both by screen width (question 1)
//   cells    'a' | 'b' | 'c'      locked, hand-edited and paused cells: icons, words, fill and corner (question 2)
//   tab      'plan' | 'changes'   the overview's tab
//   openPause true               the programme paused on Wed 16 Dec with no end date (question 2)
//   sheet    'a' | 'b'            the change sheet: one sheet, or two steps (question 3)
//   step     1 | 2                sheet B's step;  scroll 'preview' opens sheet A scrolled to its preview
//   act      'squat' | 'deadlift' the activity page;  prog 'a' | 'b'  chart or list (question 4)
//   week     'a' | 'b'            the week view's header, locked and paused days (question 5)
// The data: "Beginner 5×5", 8 weeks from Mon 23 Nov 2026; today is Wed 16 Dec, programme week 4.
// Weights were computed with the spec's engine (§3.2): decimals, rounded to 2.5 kg, halves up.
(() => {
  const P = {
    lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
    pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>', down: '<path d="m6 9 6 6 6-6"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    cal: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    stop: '<circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
    up: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
    skip: '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  }
  const ic = (name, label) => `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}>${P[name]}</svg>`
  const BOX = 'M6.5 4.8C12.5 4.3 23.5 4.6 30.2 4.9C31.4 5 31.6 6.1 31.5 7.2C31.2 13.5 31.4 22.5 31.2 29.4C31.2 30.6 30.3 31.3 29.1 31.3C22.5 31.6 13 31.2 6.6 31.4C5.4 31.4 4.7 30.6 4.7 29.4C4.6 22.8 4.9 13 4.6 6.8C4.6 5.6 5.4 4.9 6.5 4.8Z'

  // ---- The run ----
  const WEEKS = [
    { n: 1, d: '23–29 Nov', mon: 'Mon 23 Nov' }, { n: 2, d: '30 Nov–6 Dec', mon: 'Mon 30 Nov' },
    { n: 3, d: '7–13 Dec', mon: 'Mon 7 Dec' }, { n: 4, d: '14–20 Dec', mon: 'Mon 14 Dec', deload: true },
    { n: 5, d: '21–27 Dec', mon: 'Mon 21 Dec' }, { n: 6, d: '28 Dec–3 Jan', mon: 'Mon 28 Dec' },
    { n: 7, d: '4–10 Jan', mon: 'Mon 4 Jan' }, { n: 8, d: '11–17 Jan', mon: 'Mon 11 Jan', deload: true },
  ]
  const CUR = 4
  const SW = ['5 × 5', '5 × 5', '5 × 5', '3 × 5', '5 × 5', '5 × 5', '5 × 5', '3 × 5']
  // A week's value: a number, 'P' (paused), { split: [before, after, day] } or { hand, rule, on }.
  const ACTS = [
    { key: 'squat', name: 'Back squat', chip: '5 × 5', unit: 'kg', sets: SW,
      w: [40, 42.5, 45, 45, 52.5, 57.5, 60, 60], done: [3, 3, 3, 1] },
    { key: 'bench', name: 'Bench press', chip: '5 × 5', unit: 'kg', sets: SW,
      w: [30, 32.5, { split: [35, 32.5, 'Wed'] }, 32.5, 37.5, 40, 42.5, 40], done: [3, 3, 1, 1] },
    { key: 'row', name: 'Barbell row', chip: '5 × 5', unit: 'kg', sets: SW,
      w: [30, 32.5, 35, 35, 40, { hand: 35, rule: 42.5, on: '12 Dec' }, 45, 42.5], done: [3, 3, 3, 1] },
    { key: 'deadlift', name: 'Deadlift', chip: '1 × 5', unit: 'kg', sets: Array(8).fill('1 × 5'),
      w: [60, 65, 70, 'P', 'P', 75, 80, 77.5], done: [3, 2, 3], why: 'Knee' },
    { key: 'plank', name: 'Plank', chip: '3 sets', unit: 's', sets: Array(8).fill('3 sets'),
      w: [30, 30, 35, 35, 40, 40, 45, 45], done: [3, 3, 3, 1] },
  ]
  const TARGET = 3
  const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five']
  const fmt = (v, unit) => `${String(v)} ${unit}`
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')

  // ---- The overview grid as a table (Q1 A; C on a wide screen) ----
  function weekHead(wk, s) {
    const past = wk.n < CUR, cur = wk.n === CUR
    const open = s.openPause && wk.n > CUR
    const lock = past && s.cells === 'a' ? ic('lock', 'Locked') : ''
    let tag = []
    if (cur) tag.push(s.openPause ? 'Paused from Wed' : 'This week')
    if (wk.deload) tag.push('Deload')
    if (past && s.cells === 'b') tag.push('Locked')
    const tagLine = tag.map((t) => `<span class="wt">${t}</span>`).join('')
    const cls = ['wk', past ? 'past' : '', cur ? 'cur' : ''].join(' ')
    return `<th class="${cls}" scope="col"${cur ? ' aria-current="date"' : ''}><span class="wn">${lock}Week ${wk.n}</span><span class="wd">${open ? 'When resumed' : wk.d}</span>${tagLine}</th>`
  }
  function cell(a, i, s, preview) {
    const wk = WEEKS[i], v = a.w[i]
    const past = wk.n < CUR, cur = wk.n === CUR
    const cls = ['wk', past ? 'past' : '', cur ? 'cur' : '']
    let main = '', sub = '', sub2 = '', aria = ''
    const sets = a.sets[i]
    if (v === 'P') {
      cls.push('paused')
      main = s.cells === 'a' ? `${ic('pause')}Paused` : 'Paused'
      sub = a.why
    } else if (past) {
      const n = a.done[i], met = n >= TARGET
      main = `<span class="res${met ? ' met' : ''}">${n} of ${TARGET}</span>${met ? '<span class="vh">, goal met</span>' : ''}`
      sub = v.split ? `${v.split[0]} → ${v.split[1]} kg<br>from ${v.split[2]}` : fmt(v, a.unit)
    } else {
      const val = v.hand ?? v
      const pv = preview && preview[a.key] && preview[a.key][i]
      if (pv) main = `<span class="chg"><span class="was">${pv[0]} →</span> ${fmt(pv[1], a.unit)}</span>`
      else main = fmt(val, a.unit)
      sub = sets
      if (v.hand && !pv) {
        aria = ` aria-label="${fmt(val, a.unit)}, ${sets}, set by hand on ${v.on}"`
        if (s.cells === 'a') main += ic('pencil')
        if (s.cells === 'b') sub2 = `By hand, ${v.on}`
        if (s.cells === 'c') cls.push('corner')
      }
      if (cur) sub2 = `${a.done[i]} of ${TARGET} so far`
      if (!cur && a.key === 'row') cls.push('tap')
    }
    return `<td class="${cls.join(' ')}"${aria}${cls.includes('tap') ? ` data-open="${i}" tabindex="0" role="button"` : ''}><span class="cv">${main}</span>${sub ? `<span class="cs nw">${sub}</span>` : ''}${sub2 ? `<span class="cs nw">${sub2}</span>` : ''}</td>`
  }
  function table(s, preview) {
    const head = `<tr><th class="act" scope="col"><span class="vh">Activity</span></th>${WEEKS.map((w) => weekHead(w, s)).join('')}</tr>`
    const rows = ACTS.map((a) => `<tr><th class="act" scope="row"><a href="#"><span class="an">${a.name}</span></a><span class="ac"><span class="chip s">${a.chip}</span><span class="t">${TARGET} a week</span></span></th>${WEEKS.map((_, i) => cell(a, i, s, preview)).join('')}</tr>`).join('')
    return `<div class="grid-wrap" tabindex="0" aria-label="The plan, week by week"><table class="og"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`
  }

  // ---- The overview as a timeline of weeks (Q1 B; C on a phone) ----
  function goalsLine(i) {
    const met = ACTS.filter((a) => a.w[i] !== 'P' && a.done[i] >= TARGET).length
    const all = ACTS.filter((a) => a.w[i] !== 'P').length
    return met === all ? `All ${WORDS[all].toLowerCase()} goals met` : `${WORDS[met]} of ${WORDS[all].toLowerCase()} goals met`
  }
  function tlRow(a, i, s) {
    const wk = WEEKS[i], v = a.w[i], past = wk.n < CUR, cur = wk.n === CUR
    const cls = []
    let val = '', sub = ''
    if (v === 'P') { val = `${s.cells === 'a' ? ic('pause') : ''}<span class="x">Paused</span>`; sub = a.why }
    else if (past) {
      const n = a.done[i], met = n >= TARGET
      val = `<span class="res${met ? ' met' : ''}">${n} of ${TARGET}</span>`
      sub = v.split ? `${a.sets[i]}, ${v.split[0]} → ${v.split[1]} kg from ${v.split[2]}` : `${fmt(v, a.unit)}, ${a.sets[i]}`
    } else {
      const x = v.hand ?? v
      val = `${fmt(x, a.unit)} <span class="x">${a.sets[i]}</span>`
      if (v.hand && s.cells === 'a') val += ic('pencil', `set by hand on ${v.on}`)
      if (v.hand && s.cells === 'b') sub = `By hand, ${v.on}`
      if (v.hand && s.cells === 'c') cls.push('corner')
      if (cur) sub = `${a.done[i]} of ${TARGET} so far`
    }
    return `<li class="${cls.join(' ')}"><span class="n">${a.name}</span><span class="v">${val}</span>${sub ? `<span class="sub">${sub}</span>` : ''}</li>`
  }
  function timeline(s) {
    const items = WEEKS.map((wk, i) => {
      const past = wk.n < CUR, cur = wk.n === CUR
      const open = past ? s.unfolded.has(wk.n) : true
      const lock = past && s.cells === 'a' ? ic('lock', 'Locked') : ''
      const tags = []
      if (cur) tags.push(s.openPause ? 'Paused from Wed' : 'This week')
      if (wk.deload) tags.push('Deload')
      if (past && s.cells === 'b') tags.push('Locked')
      const inner = `<span class="tn">${lock}Week ${wk.n}</span><span class="tm"><span class="td">${s.openPause && wk.n > CUR ? 'When resumed' : wk.d}</span>${tags.length ? `<span class="tt">${tags.join(' · ')}</span>` : ''}</span>`
      const head = past
        ? `<button type="button" class="th" aria-expanded="${open}" data-fold="${wk.n}">${inner}<span class="sum">${goalsLine(i)}${ic('down')}</span></button>`
        : `<div class="th">${inner}</div>`
      const rows = open ? `<ul class="tr">${ACTS.map((a) => tlRow(a, i, s)).join('')}</ul>` : ''
      return `<li class="tw${past ? ' past' : ''}${cur ? ' cur' : ''}"${cur ? ' aria-current="date"' : ''}>${head}${rows}</li>`
    }).join('')
    return `<ol class="tl" aria-label="The plan, week by week">${items}</ol>`
  }

  // ---- The Changes tab ----
  const LOG = [
    { when: 'Mon 14 Dec', what: 'Deadlift paused for two weeks, from Mon 14 Dec. It comes back on Mon 28 Dec at 75 kg.', why: 'Knee', src: 'From the app' },
    { when: 'Sat 12 Dec', what: 'Barbell row set to 35 kg in week 6 only.', why: 'Hotel gym over New Year', src: 'From the app', undo: true },
    { when: 'Wed 9 Dec', what: 'Bench press set to 32.5 kg, from Wed 9 Dec. It was 35 kg.', why: 'Shoulder', src: 'From Claude' },
    { when: 'Thu 3 Dec', what: 'Back squat increase set to 7.5% a week, from Thu 3 Dec. It was 5%.', why: 'Too easy', src: 'From the app' },
    { when: 'Sun 22 Nov', what: 'Started from Mon 23 Nov, with a squat start of 40 kg and a weekly increase of 5%.', src: 'From the app' },
  ]
  const changes = () => `<ol class="log">${LOG.map((e) => `<li><span class="when">${e.when}</span><div><p class="what">${e.what}</p>${e.why ? `<p class="why">${e.why}</p>` : ''}<p class="src">${e.src}</p></div>${e.undo ? `<button type="button" class="btn sm quiet">${ic('undo')}Undo</button>` : '<span></span>'}</li>`).join('')}</ol>`

  // ---- The overview page ----
  function overview(s) {
    const useTable = s.q1 === 'a' || (s.q1 === 'c' && s.layout === 'wide')
    const meta = s.openPause
      ? 'Paused since Wed 16 Dec, in week 4 of 8. Resume it when you’re ready.'
      : '<b>Week 4 of 8.</b> Started Mon 23 Nov, ends Sun 17 Jan.'
    const plan = useTable ? table(s, s.preview) : timeline(s)
    const ends = `<p class="im ends">${ic('info')}<span>Deadlift ends at its week 6 of 8, because of its pause.</span></p>`
    const ctl = `<div class="acts controls">${s.openPause ? `<button type="button" class="btn">${ic('play')}Resume programme</button>` : `<button type="button" class="btn">${ic('pause')}Pause programme</button>`}<button type="button" class="btn">${ic('skip')}Go to week</button><button type="button" class="btn">${ic('plus')}Add activity</button><button type="button" class="btn">${ic('stop')}End programme</button></div>`
    const body = s.tab === 'changes' ? changes() : plan + ends + ctl
    return `<main class="page"><div class="topline"><a class="back" href="#">${ic('left')}<span>Back to the week</span></a></div>
      <p class="type">Programme</p><div class="titleline"><h1>Beginner 5×5</h1></div><p class="meta">${meta}</p>
      <div class="tabs" role="tablist" aria-label="Programme"><button type="button" role="tab" aria-selected="${s.tab === 'plan'}" data-tab="plan">Plan</button><button type="button" role="tab" aria-selected="${s.tab === 'changes'}" data-tab="changes">Changes</button></div>
      <div role="tabpanel">${body}</div></main>`
  }

  // ---- The change sheet (Q3) ----
  const BEFORE = { 4: 40, 5: 35, 6: 45, 7: 42.5 }
  const AFTER = { 4: 45, 5: 47.5, 6: 50, 7: 47.5 }
  function previewRows(s) {
    const idx = s.scope === 'once' ? [4] : [4, 5, 6, 7].filter((i) => i !== 5 || s.dropped)
    return idx.map((i) => {
      const wk = WEEKS[i]
      return `<li><span class="w">Week ${wk.n}<span class="d">${wk.d}${wk.deload ? ', deload' : ''}</span></span><span class="chg"><span class="was">${BEFORE[i]} →</span> ${AFTER[i]} kg</span></li>`
    }).join('')
  }
  function previewBlock(s) {
    const block = s.scope === 'once' ? ''
      : s.dropped
        ? `<div class="block"><p>${ic('pencil')}<span>The 35 kg set by hand on 12 Dec goes too.</span></p><button type="button" class="btn sm" data-drop="0">Keep it</button></div>`
        : `<div class="block"><p>${ic('pencil')}<span>Week 6 keeps the 35 kg set on 12 Dec.</span></p><button type="button" class="btn sm" data-drop="1">Drop it too</button></div>`
    const calm = s.scope === 'once' ? 'Weeks 6 to 8 stay as they are. Nothing before Mon 21 Dec changes.' : 'Nothing before Mon 21 Dec changes.'
    return `<section class="pv" aria-labelledby="pv-h"><h3 id="pv-h">What changes</h3><ol>${previewRows(s)}</ol>${block}<p class="calm">${calm}</p></section>`
  }
  function sheetFields(s) {
    return `<div class="field"><span class="label" id="f-kind">Change</span><button type="button" class="pick" aria-labelledby="f-kind" aria-haspopup="menu"><span>Set weight</span>${ic('down')}</button></div>
      <div class="row2"><div class="field"><label class="label" for="f-kg">Weight in kg</label><input class="tf num" id="f-kg" inputmode="decimal" value="45"><p class="hint">Week 5 is 40 kg now.</p></div>
      <div class="field"><span class="label" id="f-from">From</span><button type="button" class="pick" aria-labelledby="f-from"><span>Mon 21 Dec</span>${ic('cal')}</button><p class="hint">Today, Wed 16 Dec, or any later day.</p></div></div>
      <div class="field"><span class="label" id="f-for">For</span><div class="seg" role="group" aria-labelledby="f-for"><button type="button" aria-pressed="${s.scope === 'on'}" data-scope="on">From then on</button><button type="button" aria-pressed="${s.scope === 'once'}" data-scope="once">That week only</button></div></div>
      <div class="field"><label class="label" for="f-why">Reason</label><input class="tf" id="f-why" value="Rows feel light"><p class="hint">It shows in Changes.</p></div>`
  }
  function sheet(s) {
    const head = (sub) => `<div class="dlg-head"><div><h2 id="dlg-h">Change Barbell row</h2>${sub || ''}</div><button type="button" class="ib" aria-label="Close" data-close>${ic('x')}</button></div>`
    let body
    if (s.sheet === 'a') {
      body = `${head()}${sheetFields(s)}${previewBlock(s)}<div class="actions"><button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn primary">Confirm change</button></div>`
    } else if (s.step === 1) {
      body = `<p class="steps">Step 1 of 2</p>${head()}${sheetFields(s)}<div class="actions"><button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn primary" data-step="2">Preview change</button></div>`
    } else {
      const what = s.scope === 'once' ? 'Weight 45 kg in week 5 only.' : 'Weight 45 kg from Mon 21 Dec, from then on.'
      body = `<p class="steps">Step 2 of 2</p>${head()}<p class="summary">${what} <i>Rows feel light.</i></p>${previewBlock(s)}<div class="actions"><button type="button" class="btn" data-step="1">${ic('left')}Back</button><button type="button" class="btn primary">Confirm change</button></div>`
    }
    return `<div class="scrim" data-close></div><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="dlg-h"><div class="dlg-body">${body}</div></div>`
  }

  // ---- The activity page's Programme row (Q4) ----
  const SERIES = {
    squat: { a: ACTS[0], lede: 'This week is a deload: <b>45 kg</b>, 3 × 5. It goes up 7.5% a week.', note: 'Belt from week 5.',
      chips: ['3 × 5', '45 kg'], changes: [{ x: 1 + 3 / 7, label: '7.5% a week, from 3 Dec', line: '7.5% a week, from Thu 3 Dec. It was 5%.', icon: 'up' }] },
    deadlift: { a: ACTS[3], lede: 'Paused since Mon 14 Dec. Knee. It comes back on Mon 28 Dec at <b>75 kg</b>.', note: 'Hinge, don’t squat. Bar close to the shins.',
      chips: ['1 × 5'], pause: [3, 4], ends: true },
  }
  const valOf = (v) => (v === 'P' ? null : v.split ? v.split[1] : v.hand ?? v)
  function programmeList(sr) {
    const a = sr.a
    const out = []
    WEEKS.forEach((wk, i) => {
      if (sr.changes && i === 2) out.push(`<li class="cp"><span>${ic(sr.changes[0].icon)}${sr.changes[0].line}</span></li>`)
      if (sr.pause && i === sr.pause[0]) out.push(`<li class="cp"><span>${ic('pause')}Paused from Mon 14 Dec. Knee.</span></li>`)
      if (sr.pause && i === sr.pause[1] + 1) out.push(`<li class="cp"><span>${ic('play')}Back on Mon 28 Dec, where it stopped.</span></li>`)
      const v = a.w[i], cur = wk.n === CUR, past = wk.n < CUR
      const d = `${wk.d}${wk.deload ? ', deload' : ''}`
      const p = v === 'P' ? 'Paused' : `${fmt(valOf(v), a.unit)} <span class="x">${a.sets[i]}</span>`
      let o = ''
      if (past) { const n = a.done[i]; o = `<span class="res${n >= TARGET ? ' met' : ''}">${n} of ${TARGET}</span>` }
      if (cur && v !== 'P') o = `<span class="res">${a.done[i]} of ${TARGET}<span class="vh"> so far</span></span>`
      out.push(`<li class="${cur ? 'cur' : ''}${v === 'P' ? ' paused' : ''}"${cur ? ' aria-current="date"' : ''}><span class="w">${cur ? 'This week' : `Week ${wk.n}`} <span class="d">${cur ? `Week 4, ${d}` : d}</span></span><span class="p">${p}</span><span class="o">${o}</span></li>`)
    })
    return `<ol class="pl" aria-label="Planned weight, week by week">${out.join('')}</ol>`
  }
  function legend() {
    return `<ul class="legend"><li><svg viewBox="0 0 22 12"><path d="M1 6h20" style="stroke:var(--ink);stroke-width:2"/></svg>Planned</li><li><svg viewBox="0 0 22 12"><path d="M1 6h20" style="stroke:var(--ink-secondary);stroke-width:2;stroke-dasharray:6 5"/></svg>Still to come</li><li><svg viewBox="0 0 22 12"><circle cx="11" cy="6" r="6" style="fill:var(--pen)"/></svg>Goal met</li><li><svg viewBox="0 0 22 12"><circle cx="11" cy="6" r="5" style="fill:var(--canvas);stroke:var(--ink-secondary);stroke-width:2"/></svg>Goal not met</li></ul>`
  }
  function drawChart(host, sr, narrow) {
    const a = sr.a
    const W = Math.max(280, host.clientWidth), H = narrow ? 240 : 290
    const L = 40, R = 8, T = 40, B = 34
    const vals = a.w.map(valOf).filter((v) => v != null)
    const lo = Math.floor((Math.min(...vals) - 5) / 10) * 10, hi = Math.ceil((Math.max(...vals) + 2.5) / 10) * 10
    const cw = (W - L - R) / 8
    const x = (i) => L + i * cw
    const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo))
    let g = ''
    g += `<rect class="band" x="${x(CUR - 1)}" y="${T - 6}" width="${cw}" height="${H - T - B + 6}" rx="4"/>`
    for (let t = lo; t <= hi; t += 10) g += `<line class="grid-l" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="axis-t" x="${L - 8}" y="${y(t) + 5}" text-anchor="end">${t}</text>`
    g += `<text class="axis-t" x="${L - 8}" y="${T - 18}" text-anchor="end">kg</text>`
    WEEKS.forEach((wk, i) => { g += `<text class="axis-t${wk.n === CUR ? ' cur' : ''}" x="${x(i) + cw / 2}" y="${H - 8}" text-anchor="middle">${wk.n}</text>` })
    g += `<text class="axis-t" x="${L - 8}" y="${H - 8}" text-anchor="end">Wk</text>`
    // The step line, broken at a pause; solid to this week, dashed after it.
    const seg = (from, to, cls) => {
      let d = '', prev = null
      for (let i = from; i <= to; i++) {
        const v = valOf(a.w[i])
        if (v == null) { prev = null; continue }
        if (prev == null) d += `M${x(i)} ${y(v)}`
        else d += `V${y(v)}`
        d += `H${x(i + 1)}`
        prev = v
      }
      return d ? `<path class="plan${cls}" d="${d}"/>` : ''
    }
    g += seg(0, CUR - 1, '')
    // The dashed part starts where this week ends, so the step up is drawn once.
    const nextV = valOf(a.w[CUR]), curV = valOf(a.w[CUR - 1])
    g += (curV != null && nextV != null ? `<path class="plan ahead" d="M${x(CUR)} ${y(curV)}V${y(nextV)}"/>` : '') + seg(CUR, 7, ' ahead')
    // Change points, labelled above the plot.
    for (const c of sr.changes || []) {
      const cx = x(c.x), tw = c.label.length * 8.2
      const right = cx + 6 + tw > W
      g += `<line class="cp" x1="${cx}" x2="${cx}" y1="${T - 26}" y2="${H - B}"/><text class="cpl" x="${right ? cx - 6 : cx + 6}" y="${T - 14}" text-anchor="${right ? 'end' : 'start'}">${c.label}</text>`
    }
    if (sr.pause) {
      const [p0, p1] = sr.pause, mid = (x(p0) + x(p1 + 1)) / 2, my = (T + H - B) / 2
      g += `<line class="cp" x1="${x(p0)}" x2="${x(p0)}" y1="${T - 6}" y2="${H - B}"/><line class="cp" x1="${x(p1 + 1)}" x2="${x(p1 + 1)}" y1="${T - 6}" y2="${H - B}"/>`
      g += `<text class="lbl" x="${mid}" y="${my - 4}" text-anchor="middle">Paused</text><text class="lbl" x="${mid}" y="${my + 16}" text-anchor="middle">Knee</text>`
    }
    // What was done, on top: a dot per week so far, filled where the goal was met.
    a.done.forEach((n, i) => {
      const v = valOf(a.w[i]); if (v == null) return
      const cx = x(i) + cw / 2, cy = y(v), met = n >= TARGET
      g += met ? `<circle class="met" cx="${cx}" cy="${cy}" r="7"/>` : `<circle class="unmet" cx="${cx}" cy="${cy}" r="6"/>`
      if (!met) g += `<text class="lbl" x="${cx}" y="${cy + 26}" text-anchor="middle">${n} of ${TARGET}</text>`
    })
    // Two values labelled: this week's and the last week's.
    for (const i of [CUR - 1, 7]) {
      const v = valOf(a.w[i]); if (v == null) continue
      g += `<text class="val" x="${x(i) + cw / 2}" y="${y(v) - 12}" text-anchor="middle">${v}</text>`
    }
    WEEKS.forEach((_, i) => { g += `<rect class="hit" data-wk="${i}" x="${x(i)}" y="${T - 6}" width="${cw}" height="${H - T - B + 6}"/>` })
    const rows = WEEKS.map((wk, i) => {
      const v = a.w[i]
      const plan = v === 'P' ? 'Paused' : `${fmt(valOf(v), a.unit)}, ${a.sets[i]}`
      const done = a.done[i] != null && v !== 'P' ? `${a.done[i]} of ${TARGET}${a.done[i] >= TARGET ? ', goal met' : ''}` : ''
      return `<tr><th scope="row">Week ${wk.n}, ${wk.d}</th><td>${plan}</td><td>${done}</td></tr>`
    }).join('')
    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${a.name}: planned weight for each week, with the weeks done so far">${g}</svg><table class="vh"><caption>${a.name}, week by week</caption><tr><th>Week</th><th>Planned</th><th>Done</th></tr>${rows}</table><div class="tip" hidden></div>`
    const tip = host.querySelector('.tip')
    host.querySelectorAll('.hit').forEach((r) => {
      r.addEventListener('pointerenter', () => {
        const i = Number(r.dataset.wk), wk = WEEKS[i], v = a.w[i]
        const plan = v === 'P' ? 'Paused, knee' : `${fmt(valOf(v), a.unit)}, ${a.sets[i]}${wk.deload ? ', deload' : ''}`
        const done = a.done[i] != null && v !== 'P' ? `${a.done[i]} of ${TARGET}${wk.n === CUR ? ' so far' : a.done[i] >= TARGET ? ', goal met' : ''}` : ''
        tip.innerHTML = `<b>Week ${wk.n}</b> · ${wk.d}<span>${plan}</span>${done ? `<span>${done}</span>` : ''}`
        tip.hidden = false
        const left = Math.min(Math.max(0, x(i) + cw / 2 - tip.offsetWidth / 2), W - tip.offsetWidth)
        tip.style.left = `${left}px`
        tip.style.top = `${T - 6 - tip.offsetHeight - 6 + 40}px`
      })
      r.addEventListener('pointerleave', () => { tip.hidden = true })
    })
  }
  function activity(s) {
    const sr = SERIES[s.act]
    const paused = !!sr.pause
    const ctl = `<div class="acts controls"><button type="button" class="btn">${ic('pencil')}Set weight</button><button type="button" class="btn">${ic('up')}Set increase</button>${paused ? `<button type="button" class="btn">${ic('play')}Resume activity</button>` : `<button type="button" class="btn">${ic('pause')}Pause activity</button>`}<button type="button" class="btn">${ic('stop')}End activity</button></div>`
    const vis = s.prog === 'a' ? `${legend()}<div class="chart" data-chart></div>` : programmeList(sr)
    const ends = sr.ends ? `<p class="im">${ic('info')}<span>Deadlift ends at its week 6 of 8, because of its pause.</span></p>` : ''
    return `<main class="page"><div class="topline"><a class="back" href="#">${ic('left')}<span>Back to the week</span></a></div>
      <p class="type">Exercise · Beginner 5×5</p><div class="titleline"><h1>${sr.a.name}</h1>${sr.chips.map((c) => `<span class="chip">${c}</span>`).join('')}</div>
      <div style="height: calc(var(--u) * 28)"></div>
      <section class="sec" aria-labelledby="s-prog"><h2 id="s-prog">Programme</h2><div class="content"><p class="lede">${sr.lede}</p>${vis}${ends}${ctl}</div></section>
      <section class="sec" aria-labelledby="s-notes"><h2 id="s-notes">Notes</h2><div class="content"><p class="note-body">${sr.note}</p><div><button type="button" class="btn">${ic('pencil')}Edit notes</button></div></div></section></main>`
  }

  // ---- The week (Q5) ----
  const DAYS = [['Mon', 14], ['Tue', 15], ['Wed', 16], ['Thu', 17], ['Fri', 18], ['Sat', 19], ['Sun', 20]]
  const ROWS = [
    { name: 'Back squat', chips: ['3 × 5', '45 kg'], marks: ['great'] },
    { name: 'Bench press', chips: ['3 × 5', '32.5 kg'], marks: ['great'] },
    { name: 'Barbell row', chips: ['3 × 5', '35 kg'], marks: ['great'] },
    { name: 'Deadlift', chips: ['1 × 5'], paused: true },
    { name: 'Plank', chips: ['3 × 35 s'], marks: ['great'] },
  ]
  function week(s) {
    const b = s.week === 'b'
    const head = b
      ? `<header class="sh b"><h2 id="wk-h">Beginner 5×5</h2><p class="under"><span>Programme week 4 of 8, a deload.</span><a class="tlink" href="#">Open the programme</a></p></header>`
      : `<header class="sh"><h2 id="wk-h">Beginner 5×5</h2><a class="prog" href="#" aria-label="Week 4 of 8. Open the programme">Week 4 of 8${ic('right')}</a></header>`
    let cells = '<div class="hd corner-h"><span class="vh">Exercise</span></div>'
    DAYS.forEach(([dn, date], i) => {
      const met = i === 0
      const locked = i === 0
      const lock = locked && !b ? ic('lock', 'locked') : ''
      cells += `<div class="hd${met ? ' met' : ''}${locked ? ' locked' : ''}"><span class="dn"><span>${dn}</span>${lock}</span><span class="vh"> ${date} December${i === 2 ? ', today' : ''}${met ? ', two picked' : ''}</span></div>`
    })
    ROWS.forEach((r, ri) => {
      cells += `<div class="nm"><span class="n">${r.name}</span><span class="chips">${r.chips.map((c) => `<span class="chip">${c}</span>`).join('')}${r.paused && b ? '<span class="chip">Paused</span>' : ''}</span></div>`
      if (r.paused && !b) { cells += `<div class="pz">${ic('pause')}<span>Paused until Mon 28 Dec. Knee.</span></div>`; return }
      DAYS.forEach(([dn, date], i) => {
        const locked = i === 0
        if (r.paused) { cells += `<div class="d${locked ? ' locked' : ''}"><span class="dash" role="img" aria-label="${r.name}, ${dn} ${date} December, paused"><svg viewBox="-4.8 -4.8 45.6 45.6" aria-hidden="true"><path d="${BOX}"/></svg></span></div>`; return }
        const mark = (s.marks[ri] || [])[i]
        cells += `<div class="d${locked ? ' locked' : ''}"><button type="button" class="dm"${mark ? ` data-mark="${mark}"` : ''} data-r="${ri}" data-c="${i}" aria-pressed="${!!mark}"${locked ? ' aria-disabled="true"' : ''} aria-label="${r.name}, ${dn} ${date} December${i === 2 ? ', today' : ''}${locked ? ', locked' : ''}"></button></div>`
      })
    })
    return `<h1 class="wkband">14–20 December</h1><section class="screen" aria-labelledby="wk-h">${head}<div class="wg" role="group" aria-label="Beginner 5×5, 14 to 20 December">${cells}</div><div class="cue">${ic('down')}</div></section>`
  }

  // ---- Mount ----
  function render(s) {
    const el = s.el
    el.dataset.layout = s.layout
    el.dataset.cells = s.cells
    el.dataset.week = s.week
    let html
    if (s.screen === 'activity') html = activity(s)
    else if (s.screen === 'week') html = week(s)
    else html = overview(s)
    el.innerHTML = `<div class="sc">${html}</div>${s.screen === 'change' && s.sheetOpen ? sheet(s) : ''}`
    const chart = el.querySelector('[data-chart]')
    if (chart) drawChart(chart, SERIES[s.act], s.layout === 'narrow')
    // A table on a phone opens on this week, with a little of the week before it.
    const wrap = el.querySelector('.grid-wrap')
    if (wrap && s.layout === 'narrow') {
      const cur = wrap.querySelector('thead .cur'), act = wrap.querySelector('thead .act')
      // Measure on screen (a scaled frame shrinks rects but not scrollLeft), and again once the
      // fonts have loaded, since they change the column widths.
      const align = () => {
        if (!cur || !act) return
        wrap.scrollLeft = 0
        const scale = wrap.getBoundingClientRect().width / wrap.offsetWidth || 1
        const gap = cur.getBoundingClientRect().left - act.getBoundingClientRect().right
        wrap.scrollLeft = Math.max(0, gap / scale)
      }
      align()
      if (document.fonts) document.fonts.ready.then(align)
    }
    if (s.scrollTo) {
      const li = el.querySelectorAll('.tw')[Number(s.scrollTo) - 1], sc = el.querySelector('.sc')
      if (li && sc) sc.scrollTop = li.offsetTop - 8
    }
    if (s.scroll === 'preview') {
      const body = el.querySelector('.dlg-body'), pv = el.querySelector('.pv')
      if (body && pv) body.scrollTop = pv.offsetTop - 12
    }
  }
  function mount(el, opts = {}) {
    opts = Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined && v !== ''))
    const s = Object.assign({ screen: 'overview', q1: 'c', cells: 'a', tab: 'plan', sheet: 'a', step: 1, scope: 'on', dropped: false,
      act: 'squat', prog: 'a', week: 'a', layout: '' }, opts)
    s.step = Number(s.step)
    s.el = el
    s.sheetOpen = s.screen === 'change'
    s.unfolded = new Set(String(opts.unfold || '').split(',').filter(Boolean).map(Number))
    s.marks = ROWS.map((r) => (r.marks ? [...r.marks] : []))
    el.classList.add('pg')
    const measure = () => {
      const w = el.offsetWidth, h = el.offsetHeight
      const layout = (h > w && w < 1000) || w < 760 ? 'narrow' : 'wide'
      if (layout === s.layout && s.screen !== 'activity') return
      if (layout === s.layout && el.querySelector('[data-chart]')?.firstChild) return
      s.layout = layout
      render(s)
    }
    el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab],[data-fold],[data-scope],[data-drop],[data-step],[data-close],[data-open],.dm,a')
      if (!t) return
      if (t.matches('a')) { e.preventDefault(); return }
      const keep = el.querySelector('.sc')?.scrollTop || 0
      const keepDlg = el.querySelector('.dlg-body')?.scrollTop || 0
      s.scroll = null; s.scrollTo = null
      if (t.dataset.tab) s.tab = t.dataset.tab
      else if (t.dataset.fold) { const n = Number(t.dataset.fold); s.unfolded.has(n) ? s.unfolded.delete(n) : s.unfolded.add(n) }
      else if (t.dataset.scope) s.scope = t.dataset.scope
      else if (t.dataset.drop) s.dropped = t.dataset.drop === '1'
      else if (t.dataset.step) s.step = Number(t.dataset.step)
      else if (t.hasAttribute('data-close')) { s.sheetOpen = false; s.screen = 'change' }
      else if (t.dataset.open) { s.sheetOpen = true; s.screen = 'change'; s.step = 1 }
      else if (t.matches('.dm')) {
        if (t.getAttribute('aria-disabled') === 'true') return
        const r = Number(t.dataset.r), c = Number(t.dataset.c)
        s.marks[r][c] = s.marks[r][c] ? null : 'great'
      }
      render(s)
      const sc = el.querySelector('.sc'); if (sc) sc.scrollTop = keep
      const db = el.querySelector('.dlg-body'); if (db && !t.dataset.step) db.scrollTop = keepDlg
    })
    el.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('td[data-open]')) { e.preventDefault(); e.target.click() }
      if (e.key === 'Escape' && s.sheetOpen) { s.sheetOpen = false; render(s) }
    })
    new ResizeObserver(measure).observe(el)
    measure()
    return s
  }
  window.PG = { mount }
})()
