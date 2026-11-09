// The week's screens under a fixed date, drawn into any element: FX.mount(el, { f, three }).
//   f      'f1' | 'f2'   F1 a hairline under the date once a screen moves under it; F2 no line
//   three  true          Exercises, Cardio and Food: three screens under the date (round 2)
(() => {
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const EXERCISES = ['Exercises', [
    ['Back extensions', '2 min', [1, 1, 0, 0, 0, 0, 0]],
    ['Push-ups', '3 × 12', [1, 0, 1, 0, 0, 0, 0]],
    ['Squats', '3 × 15', [0, 1, 1, 0, 0, 0, 0]],
    ['Plank', '1 min', [1, 0, 0, 0, 0, 0, 0]],
  ]]
  // Round 2: a third tracker between them, to try scrolling down twice.
  const CARDIO = ['Cardio', [
    ['Cycling', '30 min', [1, 0, 0, 0, 0, 0, 0]],
    ['Running', '5 km', [0, 0, 1, 0, 0, 0, 0]],
  ]]
  const FOOD = ['Food', [
    ['Vegetables', '2 portions', [1, 1, 1, 0, 0, 0, 0]],
    ['Fruit', '2 pieces', [1, 0, 1, 0, 0, 0, 0]],
    ['Water', '2 litres', [1, 1, 0, 0, 0, 0, 0]],
  ]]
  function grid(rows) {
    const head = DAYS.map((d, i) => `<div class="fx-head${i === 2 ? ' today' : ''}">${d}</div>`).join('')
    const body = rows.map(([n, c, m]) => `<div class="fx-name">${n}<span class="fx-chip">${c}</span></div>` +
      m.map((x) => `<div class="fx-cell"><span class="fx-box${x ? ' on' : ''}"></span></div>`).join('')).join('')
    return `<div class="fx-grid"><div class="fx-corner"></div>${head}${body}</div>`
  }
  function mount(el, o = {}) {
    el.classList.add('fx')
    el.dataset.f = o.f || 'f1'
    const list = o.three ? [EXERCISES, CARDIO, FOOD] : [EXERCISES, FOOD]
    const screens = list.map(([title, rows], i) => {
      const next = list[i + 1], back = list[i - 1]
      const hint = next ? `Scroll for ${next[0]}` : `Scroll back for ${back[0]}`
      const up = back ? `<span class="fx-up" aria-hidden="true">⌃</span>` : ''
      return `<section class="fx-screen">${up}<h2 class="fx-sec">${title}</h2>${grid(rows)}<p class="fx-hint">${hint}</p></section>`
    }).join('')
    el.innerHTML = `<div class="fx-scroll" tabindex="0" aria-label="The week, scrollable"><h1 class="fx-band">2–8 November</h1>${screens}</div>`
    const scroller = el.firstElementChild
    const mark = () => scroller.classList.toggle('under', scroller.scrollTop > 0)
    scroller.addEventListener('scroll', mark, { passive: true })
    if (o.at === 'food') requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight; mark() })
  }
  window.FX = { mount }
})()
