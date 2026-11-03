// Connections, drawn so the options and states can be tried in place.
//   CN.consent(el, { opt: 'c1' | 'c2', state })   the screen claude.ai sends you to
//     state: 'in' (signed in) | 'out' (signed out) | 'wrong' | 'code' (Claude Code) | 'expired'
//   CN.settings(el, { opt: 'l1' | 'l2', state })  Settings › Connections
//     state: 'list' | 'new' | 'empty' | 'create' | 'shown' | 'toomany' | 'confirm'
// Each draws into el and sizes itself from el's own box (settings.css + conn.css). Buttons move
// between states, so a frame can be pressed through. The data is a plausible account.
(() => {
  const ART = window.BAR_ART
  const ICONS = Object.assign({}, ART.icons, {
    'triangle-alert': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    'circle-alert': '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    trash: '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    'key-round': '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
  })
  const I = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`
  const wm = () => `<svg class="wm" viewBox="${ART.wordmark.viewBox || '0 -760 3200 800'}" role="img" aria-label="Tracker"><path d="${ART.wordmark.path}"/></svg>`
  const ADDRESS = 'https://tracker.itsa-pizza.com/api/mcp'
  let n = 0

  // ---------- The consent screen ----------
  function access(opt, write) {
    if (opt === 'c1') {
      return `<div class="cn-field">
  <button type="button" role="switch" class="cn-switch" aria-checked="${write}" data-act="toggle"><span class="cn-track"><span class="cn-thumb"></span></span>Allow changes</button>
  <p class="caption cn-hint">${write ? 'Claude can read your plans and marks, mark days and edit plans.' : 'Claude can read your plans, marks and notes. It can’t change anything.'}</p>
</div>`
    }
    const r = (v, name, what) => `<button type="button" role="radio" class="cn-radio" aria-checked="${v === write}" data-act="pick" data-v="${v}"><span class="dot"></span><span class="what"><b class="body">${name}</b><span class="caption">${what}</span></span></button>`
    return `<fieldset class="cn-radios" role="radiogroup"><legend class="body">What Claude can do</legend>
  ${r(false, 'Read only', 'See your plans, marks and notes.')}
  ${r(true, 'Read and change', 'Also mark days, and add and edit items.')}
</fieldset>`
  }

  function consent(el, o) {
    n += 1
    const s = o.state || 'in'
    const app = s === 'code' ? 'Claude Code' : 'Claude'
    if (s === 'expired') {
      el.innerHTML = `<div class="cn-auth"><section class="cn-card">${wm()}<h1 class="title-1">This link has expired</h1>
  <p class="body cn-intro">It was already used, or it’s more than ten minutes old. Go back to Claude and connect again.</p>
  <p class="body"><a href="#">Go to the week</a></p></section></div>`
      return
    }
    const wrong = s === 'wrong'
    const email = s === 'out' ? '' : 'sam@example.com'
    const back = s === 'code' ? 'this computer (localhost)' : 'claude.ai'
    el.innerHTML = `<div class="cn-auth"><section class="cn-card" aria-labelledby="cn-t-${n}">${wm()}
  <h1 class="title-1" id="cn-t-${n}">Connect ${app}</h1>
  <p class="body cn-warn">${I('triangle-alert')}<span>Only continue if you just asked ${app} to connect to your tracker. If you didn’t, choose Cancel.</span></p>
  <form class="cn-form" onsubmit="return false" style="margin-top:16px">
    <dl class="cn-who body"><dt>Asking</dt><dd>${app}, from claude.ai</dd><dt>Then back to</dt><dd>${back}</dd></dl>
    <div class="cn-field"><label class="body" for="cn-e-${n}" style="font-weight:600">Email</label>
      <input class="cn-input" id="cn-e-${n}" value="${email}" autocomplete="username"${wrong ? ' aria-invalid="true"' : ''}></div>
    <div class="cn-field"><label class="body" for="cn-p-${n}" style="font-weight:600">Password</label>
      <input class="cn-input" id="cn-p-${n}" type="password" value="${wrong ? 'xxxxxxxxxxxx' : ''}" autocomplete="current-password"${wrong ? ' aria-invalid="true"' : ''}>
      ${s === 'in' || s === 'code' ? '<p class="caption cn-hint">You’re signed in, but connecting an app asks for your password again.</p>' : ''}</div>
    ${wrong ? `<p class="body cn-msg">${I('circle-alert')}<span>Wrong email or password. Check them and try again.</span></p>` : ''}
    ${access(o.opt, !!o.write)}
    <div class="cn-btns"><button type="button" class="btn">Cancel</button><button type="button" class="btn primary" data-act="approve">Connect</button></div>
  </form>
  <p class="caption cn-foot">The connection lasts 90 days. You can remove it sooner in Settings › Connections.</p>
</section></div>`
    el.onclick = (e) => {
      const b = e.target.closest('[data-act]')
      if (!b) return
      if (b.dataset.act === 'toggle') consent(el, { ...o, write: !o.write })
      if (b.dataset.act === 'pick') consent(el, { ...o, write: b.dataset.v === 'true' })
      if (b.dataset.act === 'approve' && s === 'out') consent(el, { ...o, state: 'wrong' })
    }
  }

  // ---------- Settings › Connections ----------
  const APPS = [
    { name: 'Claude', host: 'claude.ai', write: true, since: '3 Nov at 14:02', used: 'today at 14:05', ends: '1 Feb', isNew: true },
    { name: 'Claude Code', host: 'claude.ai', write: false, since: '28 Oct at 09:12', used: 'yesterday', ends: '26 Jan' },
  ]
  const TOKENS = [
    { name: 'Laptop', prefix: 'trk_Xq7mPa2L', write: true, since: '24 Oct', used: '2 Nov' },
    { name: 'Weekly report script', prefix: 'trk_b9RkT0wc', write: false, since: '30 Oct', used: 'never' },
  ]
  const NEW_TOKEN = { name: 'Desktop', prefix: 'trk_Hn3vY8sE', write: false, since: 'today', used: 'never' }
  const PLAIN = 'trk_Hn3vY8sE4dKqLw0ZpRt6Uj1Xb5MfNaGc2VyOiTe7Ws'
  const scope = (w) => (w ? 'Read and change' : 'Read only')

  function create(state) {
    if (state === 'create' || state === 'toomany') {
      return `<form class="cn-create" onsubmit="return false">
  <div class="cn-f"><label for="tn-${n}">Name</label><input id="tn-${n}" value="Desktop" maxlength="64"></div>
  <div class="cn-f"><span class="lbl" id="ta-${n}">Access</span><div class="seg" role="group" aria-labelledby="ta-${n}"><button type="button" aria-pressed="true">Read only</button><button type="button" aria-pressed="false">Read and change</button></div></div>
  <div class="btns"><button type="button" class="btn" data-go="list">Cancel</button><button type="button" class="btn primary" data-go="${state === 'toomany' ? 'toomany' : 'shown'}">Create token</button></div>
</form>${state === 'toomany' ? `<p class="cn-msg sp-size">${I('circle-alert')}<span>You have 20 tokens, the most there can be. Remove one you don’t use, then create this one.</span></p>` : ''}`
    }
    if (state === 'shown') {
      return `<div class="cn-shown"><p class="lead">Copy your new token now. It won’t be shown again.</p>
  <div class="cn-copy"><code>${PLAIN}</code><button type="button" class="btn">${I('copy')}Copy</button></div>
  <p class="cn-lede">Give it to the app as a header: <code class="cn-code">Authorization: Bearer ${PLAIN.slice(0, 12)}…</code></p>
  <div class="btns"><button type="button" class="btn" data-go="list">Done</button></div></div>`
    }
    return `<div class="btns"><button type="button" class="btn" data-go="create">${I('plus')}Create token</button></div>`
  }

  function how() {
    return `<div class="cn-how">
  <div class="cn-copy"><code>${ADDRESS}</code><button type="button" class="btn">${I('copy')}Copy</button></div>
  <p><b>Claude (claude.ai, desktop and phone):</b> in Claude’s Settings › Connectors, choose Add custom connector and paste this address. Claude opens this page to ask for your password.</p>
  <p><b>Claude Code:</b> run <code class="cn-code">claude mcp add --transport http tracker ${ADDRESS}</code>, then <code class="cn-code">/mcp</code> to sign in. Or use a token below.</p>
</div>`
  }

  function l1(state) {
    const apps = state === 'empty' ? [] : APPS.map((a) => ({ ...a, isNew: a.isNew && state === 'new' }))
    const tokens = state === 'empty' ? [] : state === 'shown' ? [NEW_TOKEN, ...TOKENS] : TOKENS
    const appRows = apps.length
      ? `<ul class="cn-list">${apps.map((a) => `<li><div class="cn-what"><span class="cn-name">${a.name} <span class="host">· ${a.host}</span></span>
  <span class="cn-facts">${a.isNew ? '<span class="new">New</span> · ' : ''}${scope(a.write)} · connected ${a.since} · last used ${a.used} · ends ${a.ends}</span></div>
  <button type="button" class="btn" data-go="confirm">Remove</button></li>`).join('')}</ul>`
      : '<p class="cn-lede">No apps are connected.</p>'
    const tokRows = tokens.length
      ? `<ul class="cn-list">${tokens.map((t) => `<li><div class="cn-what"><span class="cn-name">${t.name}</span>
  <span class="cn-facts"><span class="cn-code">${t.prefix}…</span> · ${scope(t.write)} · created ${t.since} · ${t.used === 'never' ? 'never used' : 'last used ' + t.used}</span></div>
  <button type="button" class="btn" data-go="confirm">Remove</button></li>`).join('')}</ul>`
      : '<p class="cn-lede">No tokens yet.</p>'
    return `${state === 'new' ? `<div class="cn-banner"><p><b>Claude was connected just now</b>, with read and change. If that wasn’t you, remove it and change your password.</p><button type="button" class="btn" data-go="confirm">Remove</button><button type="button" class="btn" data-go="list">Dismiss</button></div>` : ''}
  <p class="cn-lede">Let Claude read your weeks and, if you allow it, mark days and edit your plans.</p>
  ${how()}
  <div class="cn-group"><h3 class="cn-sub">Apps</h3><p class="cn-lede">Connected by signing in from Claude. Each lasts 90 days.</p>${appRows}</div>
  <div class="cn-group"><h3 class="cn-sub">Tokens</h3><p class="cn-lede">For Claude Code, Claude Desktop and scripts. A token works until you remove it.</p>${state === 'shown' ? create(state) + tokRows : tokRows + create(state)}</div>`
  }

  function l2(state) {
    const empty = state === 'empty'
    const rows = empty ? [] : [
      ...APPS.map((a) => ({ n: a.name, sub: a.host, kind: 'App', w: a.write, since: a.since.split(' at ')[0], used: a.used, ends: a.ends, isNew: a.isNew && state === 'new' })),
      ...(state === 'shown' ? [NEW_TOKEN] : []).concat(TOKENS).map((t) => ({ n: t.name, sub: `<span class="cn-code">${t.prefix}…</span>`, kind: 'Token', w: t.write, since: t.since, used: t.used, ends: 'never' })),
    ]
    const table = rows.length
      ? `<table class="cn-table"><thead><tr><th>Name</th><th>Kind</th><th>Access</th><th>Since</th><th>Last used</th><th>Ends</th><th><span class="vh">Remove</span></th></tr></thead><tbody>
${rows.map((r) => `<tr><td class="n">${r.n}${r.isNew ? ' <span class="new">· New</span>' : ''}<small>${r.sub}</small></td><td data-h="Kind">${r.kind}</td><td data-h="Access">${scope(r.w)}</td><td data-h="Since">${r.since}</td><td data-h="Last used">${r.used}</td><td data-h="Ends">${r.ends}</td><td><button type="button" class="btn" data-go="confirm">Remove</button></td></tr>`).join('')}
</tbody></table>`
      : '<p class="cn-lede">Nothing is connected, and there are no tokens.</p>'
    return `${state === 'new' ? `<div class="cn-banner"><p><b>Claude was connected just now</b>, with read and change. If that wasn’t you, remove it and change your password.</p><button type="button" class="btn" data-go="confirm">Remove</button><button type="button" class="btn" data-go="list">Dismiss</button></div>` : ''}
  <p class="cn-lede">Let Claude read your weeks and, if you allow it, mark days and edit your plans. Apps connect by signing in from Claude and last 90 days. Tokens are for Claude Code, Claude Desktop and scripts, and work until you remove them.</p>
  ${how()}
  ${state === 'shown' ? create(state) + table : table + create(state)}`
  }

  function settings(el, o) {
    n += 1
    const s = o.state || 'list'
    const body = o.opt === 'l2' ? l2(s) : l1(s)
    const dialog = s === 'confirm'
      ? `<div class="cn-scrim"></div><div class="cn-dialog" role="dialog" aria-modal="true" aria-labelledby="cd-${n}"><h2 id="cd-${n}">Remove Laptop?</h2>
  <p>Anything using this token stops working at once. You can create a new one.</p>
  <div class="acts btns"><button type="button" class="btn" data-go="list">Cancel</button><button type="button" class="btn primary" data-go="list">Remove</button></div></div>`
      : ''
    el.innerHTML = `<div class="sp" data-layout="a" style="width:100%;height:100%"><div class="sp-scroll"><main class="sp-page">
  <a class="sp-back" href="#">${I('chevron-left')}<span>Back to the week</span></a>
  <h1 class="sp-title">Settings</h1>
  <section class="sp-sec"><h2>Your data</h2><div class="sp-body"><div class="sp-row"><p class="sp-lede">Export saves everything to a file. Import adds a file’s plans and marks to yours and never deletes anything.</p><div class="btns"><button type="button" class="btn">${I('download')}Export</button><button type="button" class="btn">${I('upload')}Import…</button></div></div></div></section>
  <section class="sp-sec"><h2>Connections</h2><div class="sp-body">${body}</div></section>
  <section class="sp-sec"><h2>Account</h2><div class="sp-body"><div class="sp-row"><p class="sp-lede">Signed in as <span class="who">sam@example.com</span></p><div class="btns"><button type="button" class="btn">${I('log-out')}Sign out</button></div></div></div></section>
</main></div>${dialog}</div>`
    el.onclick = (e) => {
      const b = e.target.closest('[data-go]')
      if (b) settings(el, { ...o, state: b.dataset.go })
    }
  }

  window.CN = { consent, settings }
})()
