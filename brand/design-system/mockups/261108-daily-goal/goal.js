// The Settings page with the Daily goal switch, drawn into any element: DG.mount(el, { place }).
//   place  'goals' | 'look'   A: in Your goals, above the text; B: in Appearance, after Theme
// The page uses settings.css (the shipped Settings frame, sizes from the frame's own box). The
// switch is the Switch card at the page's sizes, as the item page's Show switch is.
(() => {
  const sw = (on) => `<button type="button" class="dg-switch" role="switch" aria-checked="${on}"><span class="dg-label">Daily goal</span><span class="dg-track" aria-hidden="true"><span class="dg-thumb"></span></span></button>`
  const hint = '<p class="dg-hint">A number of exercises and of foods to reach each day, set in Edit plan. A day that reaches it turns green.</p>'
  const field = (on) => `<div class="dg-field">${sw(on)}${hint}</div>`
  const marks = '<div class="sp-field"><span class="sp-label">Marks</span><p class="sp-lede">Squiggles, Ticks, Stamped ticks, Faces or Stamped faces, as now.</p></div>'
  const theme = '<div class="sp-field"><span class="sp-label">Theme</span><div class="seg" role="group" aria-label="Theme"><button type="button" aria-pressed="true">System</button><button type="button" aria-pressed="false">Light</button><button type="button" aria-pressed="false">Dark</button></div></div>'
  const goals = '<div class="sp-field"><label class="sp-label" for="g">What you’re working towards</label><textarea id="g" class="dg-text" rows="4">Ten pull-ups in a row by March.\nVegetables every day.</textarea><p class="dg-hint">Ask reads this when it answers. Nothing else does.</p></div>'

  function mount(el, o = {}) {
    el.classList.add('sp')
    el.dataset.layout = 'a'
    const place = o.place || 'goals'
    const on = o.on !== false
    el.innerHTML = `<div class="sp-scroll"><main class="sp-page">
  <a class="sp-back" href="#"><span>‹ Back to the week</span></a>
  <h1 class="sp-title">Settings</h1>
  <section class="sp-sec"><h2>Appearance</h2><div class="sp-body">${marks}${theme}${place === 'look' ? field(on) : ''}</div></section>
  <section class="sp-sec"><h2>Your goals</h2><div class="sp-body">${place === 'goals' ? field(on) : ''}${goals}</div></section>
  <section class="sp-sec"><h2>Your data</h2><div class="sp-body"><p class="sp-lede">Export and Import…, as now.</p></div></section>
</main></div>`
    el.addEventListener('click', (e) => {
      if (e.target.closest('a')) e.preventDefault()
      const b = e.target.closest('.dg-switch')
      if (b) b.setAttribute('aria-checked', String(b.getAttribute('aria-checked') !== 'true'))
    })
  }
  window.DG = { mount }
})()
