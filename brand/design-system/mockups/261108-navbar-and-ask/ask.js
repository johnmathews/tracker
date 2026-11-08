// The Ask page, drawn so its layout and states can be tried in place. AP.mount(el, options) draws
// the page into el and sizes it from el's own box (settings.css + ask.css), so one script draws a
// scaled desktop, a phone and the full-size try page. Round 2026-11-08 adds the two views, the
// smaller sizes and the switch between the views. Options:
//   layout  'a' | 'd' | 'b'               Document as rows (D1); Document as headings (D2);
//                                         Conversation (the 1 November mockup's B)
//   doc     'a' | 'd'                     which Document the switch goes back to
//   scale   '100' | '80' | '70'           the page's sizes: now, S1, S2
//   state   'chat' | 'empty' | 'nogoals' | 'cap' | 'error' | 'offline' | 'unsynced'
//   live    true                          stream the second answer, and let Send ask again
// AP.goals(el) draws the Settings page's new "Your goals" row. The numbers are the seed week's.
(() => {
  const ICONS = Object.assign({}, window.BAR_ART.icons, {
    'message-circle': '<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/>',
    send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
    square: '<rect width="14" height="14" x="5" y="5" rx="2"/>',
    trash: '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    'panel-left': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
    'square-pen': '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    'rotate-ccw': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  })
  const I = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`

  const Q1 = 'Am I doing enough to meet my goals this month?'
  const A1 = `<p class="ask-read">Read this week and the three before it, and your goals.</p>
<p>Mostly, yes. Over four weeks you met <strong>Push-ups</strong> and <strong>Squats</strong> every week, at four days each. <strong>Pull-ups</strong> met its four days twice; the other two weeks had three.</p>
<p>Your goal says “Ten pull-ups in a row by March”. Three or four days a week of three reps is steady, but the reps haven’t gone up since 12 October. One more rep a set every second week would get you there by March.</p>
<p>Back extensions and Kettlebell halos are at their three days most weeks. Nothing there looks like too much.</p>`
  const Q2 = 'Is my diet good enough?'
  const A2_PARTS = [
    '<p>Fruit and Nuts are on track: five and three days most weeks. ',
    '<strong>Vegetables</strong> is the gap: five days this week against a goal of seven, and five or six in each of the last four. ',
    'Fish met its two days in three of the four weeks.</p>',
    '<p>So the week isn’t short on much. Two more vegetable days would meet every food goal; most weeks the missing days are Saturday and Sunday.</p>',
  ]

  const turn = (q, a) => `<div class="ask-turn"><p class="ask-q">${q}</p><div class="ask-a">${a}</div></div>`
  const progress = (label) => `<span class="ask-progress" role="status"><span class="pen" aria-hidden="true"><i></i><i></i><i></i></span>${label}</span>`

  function box(state, busy) {
    const left = state === 'cap' ? 0 : state === 'chat' ? 27 : 30
    const chip = left === 0 ? 'No questions left today' : left <= 3 ? `${['No', 'One', 'Two', 'Three'][left]} questions left today` : `${left} questions left today`
    const disabled = state === 'cap' || state === 'offline'
    const note = state === 'cap' ? '<p class="ask-note">You can ask again from 09:14 tomorrow.</p>'
      : state === 'unsynced' ? '<p class="ask-note">Two changes on this device aren’t synced yet, so the answer won’t include them.</p>'
      : '<p class="ask-note">Answers come from an AI and can be wrong. They aren’t medical advice.</p>'
    const btn = busy
      ? `<button type="button" class="btn" data-act="stop">${I('square')}Stop</button>`
      : `<button type="button" class="btn primary" data-act="send"${disabled ? ' disabled' : ''}>${I('send')}Send</button>`
    return `<div class="ask-box"><form class="ask-form" onsubmit="return false">
  <label for="q-${n}">Your question</label>
  <textarea id="q-${n}" rows="3"${disabled ? ' disabled' : ''}></textarea>${btn}
  <div class="ask-foot"><span class="quota" data-left="${left}">${chip}</span>${note}</div>
</form></div>`
  }

  let n = 0
  function page(opts) {
    n += 1
    const s = opts.state || 'chat'
    let body = ''
    if (s === 'empty' || s === 'nogoals') {
      body = `<div class="ask-empty">
  <p>Ask about your exercises and food: whether you’re doing enough for your goals, how steady the weeks are, what to change. The answer reads your plans and marks for the last eight weeks${s === 'nogoals' ? '.' : ', and your goals in Settings.'}</p>
  ${s === 'nogoals' ? '<p>Your goals in Settings are empty, so answers can only compare you with the times a week you set. <a href="#">Add your goals</a></p>' : ''}
  <div class="ask-starts"><button type="button" class="btn">Am I doing too much or too little?</button><button type="button" class="btn">Is my diet good enough?</button><button type="button" class="btn">How steady was this month?</button></div>
</div>`
    } else {
      body = turn(Q1, A1)
      if (s === 'chat') body += turn(Q2, opts.live ? `<span data-stream></span>${progress('Reading your weeks…')}` : A2_PARTS.slice(0, 2).join('') + '<span class="ask-caret" aria-hidden="true"></span></p>')
      if (s === 'error') body += turn(Q2, '<p class="ask-msg" data-kind="error">The answer stopped before it finished, because the AI service didn’t respond. Your question is kept. <a href="#">Try again</a></p>')
      if (s === 'offline') body += '<p class="ask-msg">You’re offline. Asking needs a connection; your marks are saved on this device.</p>'
      if (s === 'cap' || s === 'unsynced') body += turn(Q2, A2_PARTS.join(''))
    }
    const busy = s === 'chat'
    const log = `<div class="ask-log" role="log" aria-live="polite">${body}</div>
  ${box(s, busy)}`
    const conv = (opts.layout || 'a') === 'b'
    const head = `<a class="sp-back" href="#">${I('chevron-left')}<span>Back to the week</span></a>
  <div class="ask-head"><h1 class="sp-title" tabindex="-1">Ask</h1>
  <div class="seg ask-view" role="group" aria-label="View"><button type="button" data-view="doc" aria-pressed="${!conv}">Document</button><button type="button" data-view="conv" aria-pressed="${conv}">Conversation</button></div></div>`
    // Round 2: where past conversations sit. H1 a History row above the conversation, in A's
    // row language; H2 a rail beside it. No `history` option draws round 1's page.
    if (opts.history === 'h1') {
      return `<main class="sp-page">${head}
  <section class="ask-hist-row" aria-labelledby="hh-${n}"><h2 class="ask-side" id="hh-${n}">History</h2>${historyList(true)}</section>
  ${log}
</main>`
    }
    if (opts.history === 'h2') {
      return `<main class="sp-page">${head}
  <div class="ask-rail-grid"><nav class="ask-rail" aria-labelledby="hr-${n}"><h2 class="ask-side" id="hr-${n}">History</h2>${historyList(false)}</nav>
  <div class="ask-main">${log}</div></div>
</main>`
    }
    return `<main class="sp-page">${head}
  ${log}
</main>`
  }

  const PAST = [
    ['Is my diet good enough?', 'Today', true],
    ['Am I doing enough to meet my goals this month?', 'Today', false],
    ['Why do my knees ache after squats?', '28 Oct', false],
    ['How steady was October?', '26 Oct', false],
    ['Should I add a rest day?', '19 Oct', false],
    ['Am I eating enough fish?', '12 Oct', false],
  ]
  function historyList(compact) {
    const shown = compact ? PAST.slice(0, 4) : PAST
    const items = shown.map(([t, d, cur]) => `<li class="hist-item"${cur ? ' aria-current="true"' : ''}>
      <a href="#" class="hist-open"><span class="hist-title">${t}</span><span class="hist-date">${d}</span></a>
      <button type="button" class="hist-del" aria-label="Delete “${t}”">${I('trash')}</button></li>`).join('')
    return `<div class="hist">
    <button type="button" class="btn hist-new">${I('plus')}New conversation</button>
    <ul class="hist-list">${items}</ul>
    <p class="hist-foot">${compact ? `<a href="#">Show all ${PAST.length}</a> · ` : ''}<a href="#">Delete all conversations</a></p>
  </div>`
  }

  function stream(el) {
    const slot = el.querySelector('[data-stream]')
    if (!slot) return
    const prog = slot.nextElementSibling
    let i = 0
    const html = A2_PARTS.join('')
    const words = html.split(/(?<=\s)/)
    let shown = ''
    setTimeout(function tick() {
      if (!el.isConnected) return
      if (prog) prog.remove()
      shown += words[i++]
      slot.innerHTML = shown + (i < words.length ? '<span class="ask-caret" aria-hidden="true"></span>' : '')
      if (i < words.length) setTimeout(tick, 45)
      else {
        const stop = el.querySelector('[data-act="stop"]')
        if (stop) stop.outerHTML = `<button type="button" class="btn primary" data-act="send">${I('send')}Send</button>`
      }
    }, 1400)
  }

  // Round 3: the history as a side panel that hides and shows (S1: hides to a strip of icons;
  // S2: hides away, its button moves beside "Back to the week"). A vertical border separates it
  // from the conversation. On a phone it opens over the page as a drawer, with a scrim.
  const GROUPS = [
    ['Today', [['Is my diet good enough?', true], ['Am I doing enough to meet my goals this month?', false]]],
    ['Last week', [['Why do my knees ache after squats?', false], ['How steady was October?', false]]],
    ['Earlier', [['Should I add a rest day?', false], ['Am I eating enough fish?', false], ['Is three times a week enough for pull-ups?', false]]],
  ]
  function panel() {
    const groups = GROUPS.map(([g, items]) => `<section class="side-group"><h3 class="side-label">${g}</h3><ul class="side-list">${items.map(([t, cur]) => `<li class="side-item"${cur ? ' aria-current="true"' : ''}><a href="#" class="side-open">${t}</a><button type="button" class="side-del" aria-label="Delete “${t}”">${I('trash')}</button></li>`).join('')}</ul></section>`).join('')
    return `<aside class="side" aria-label="Conversation history">
    <div class="side-head"><h2 class="side-title">History</h2><button type="button" class="icon-btn" data-act="panel" aria-expanded="true" aria-controls="side-${n}" aria-label="Hide history" title="Hide history">${I('panel-left')}</button></div>
    <div class="side-strip"><button type="button" class="icon-btn" data-act="panel" aria-expanded="false" aria-label="Show history" title="Show history">${I('panel-left')}</button><button type="button" class="icon-btn" aria-label="New conversation" title="New conversation">${I('square-pen')}</button></div>
    <div class="side-body" id="side-${n}">
      <button type="button" class="btn side-new">${I('square-pen')}New conversation</button>
      <div class="side-scroll">${groups}</div>
      <p class="side-foot"><button type="button" class="side-link">Delete all conversations</button></p>
    </div>
  </aside>`
  }
  function sidePage(opts) {
    const inner = page({ ...opts, history: undefined })
    const toggle = `<button type="button" class="icon-btn main-toggle" data-act="panel" aria-expanded="false" aria-label="Show history" title="Show history">${I('panel-left')}</button>`
    return `<div class="side-shell" data-variant="${opts.history}" data-panel="${opts.panel || 'open'}">
  ${panel()}
  <div class="side-scrim" data-act="panel" aria-hidden="true"></div>
  <div class="side-main">${inner.replace('<main class="sp-page">', `<main class="sp-page">${toggle}`)}</div>
</div>`
  }

  function mount(el, opts = {}) {
    el.classList.add('sp')
    el.dataset.layout = opts.layout || 'a'
    el.dataset.scale = opts.scale || '100'
    const doc = opts.doc || (opts.layout === 'd' ? 'd' : 'a')
    // The view switch: Document (the default) or Conversation, remembered per device in the app.
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-view]')
      if (!b) return
      el.dataset.layout = b.dataset.view === 'conv' ? 'b' : doc
      for (const x of el.querySelectorAll('[data-view]')) x.setAttribute('aria-pressed', String(x === b))
    })
    const side = opts.history === 's1' || opts.history === 's2'
    el.innerHTML = side ? `<div class="sp-scroll side-root">${sidePage(opts)}</div>` : `<div class="sp-scroll">${page(opts)}</div>`
    if (side) {
      el.addEventListener('click', (e) => {
        if (!e.target.closest('[data-act="panel"]')) return
        const shell = el.querySelector('.side-shell')
        shell.dataset.panel = shell.dataset.panel === 'open' ? 'closed' : 'open'
      })
    }
    if (opts.live) stream(el)
    el.addEventListener('click', (e) => {
      if (e.target.closest('a')) e.preventDefault()
      if (opts.live && e.target.closest('[data-act="stop"]')) {
        e.target.closest('[data-act="stop"]').outerHTML = `<button type="button" class="btn primary" data-act="send">${I('send')}Send</button>`
      }
    })
  }

  function goals(el, opts = {}) {
    el.classList.add('sp')
    el.dataset.layout = opts.layout || 'a'
    const text = 'Ten pull-ups in a row by March.\nVegetables every day.\nFeel less stiff after sitting all day.'
    el.innerHTML = `<div class="sp-scroll"><main class="sp-page">
  <a class="sp-back" href="#">${I('chevron-left')}<span>Back to the week</span></a>
  <h1 class="sp-title" tabindex="-1">Settings</h1>
  <section class="sp-sec"><h2>Planner</h2><div class="sp-body"><div class="sp-field sp-inline"><span class="sp-label">Exercises a day and foods a day</span><span class="sp-lede">as now</span></div></div></section>
  <section class="sp-sec" aria-labelledby="g-${++n}"><h2 id="g-${n}">Your goals</h2><div class="sp-body">
    <div class="sp-field ask-form" style="grid-template-columns: minmax(0, 1fr)">
      <label for="gt-${n}">What you’re working towards</label>
      <textarea id="gt-${n}" rows="4" aria-describedby="gh-${n}">${text}</textarea>
      <p class="ask-note" id="gh-${n}">Ask reads this when it answers. Nothing else does. Saved as you type.</p>
    </div>
  </div></section>
  <section class="sp-sec"><h2>Your data</h2><div class="sp-body"><p class="sp-lede">as now</p></div></section>
</main></div>`
  }

  window.AP = { mount, goals, icon: I }
})()
