// The Exercises screen with the date as its title, drawn into any element: WK.mount(el, { t }).
//   t  'now' | 't1' | 't2'   as shipped; T1 the section in the sans; T2 the section in a smaller serif
(() => {
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const ROWS = [
    ['Back extensions', '2 min', [1, 0, 0, 0, 0, 0, 0]],
    ['Push-ups', '3 × 12', [1, 0, 1, 0, 0, 0, 0]],
    ['Squats', '3 × 15', [0, 1, 1, 0, 0, 0, 0]],
  ]
  function mount(el, o = {}) {
    el.classList.add('wk')
    el.dataset.t = o.t || 't1'
    const head = DAYS.map((d, i) => `<div class="wk-head${i === 2 ? ' today' : ''}">${d}</div>`).join('')
    const rows = ROWS.map(([n, c, m]) => `<div class="wk-name">${n}<span class="wk-chip">${c}</span></div>` +
      m.map((x) => `<div class="wk-cell"><span class="wk-box${x ? ' on' : ''}"></span></div>`).join('')).join('')
    el.innerHTML = `<div class="wk-in">
  <h1 class="wk-date">2–8 November</h1>
  <h2 class="wk-sec">Exercises<span class="wk-now">2–8 November</span></h2>
  <div class="wk-grid"><div class="wk-corner"></div>${head}${rows}</div>
</div>`
  }
  window.WK = { mount }
})()
