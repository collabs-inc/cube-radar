// Radar's page: Scout on the left (kit/persona.js), the inbox in the middle, the loops on the right.
// Everything comes from the server's API and refreshes on its event stream (/api/events).
import { mountPersona, applyTheme, md } from '/kit/persona.js';
applyTheme();

const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const api = async (p, opts = {}) => {
  const r = await fetch(p, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
  const type = r.headers.get('content-type') || '';
  const body = type.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error(body?.error || r.statusText);
  return body;
};
const post = (p, b = {}) => api(p, { method: 'POST', body: JSON.stringify(b) });

// ---- sources ----
const SOURCES = {
  x: { name: 'X', glyph: '𝕏', open: 'Open on X' },
  linkedin: { name: 'LinkedIn', glyph: 'in', open: 'Open on LinkedIn' },
  reddit: { name: 'Reddit', glyph: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="14" r="6.5"/><circle cx="18.6" cy="5.4" r="1.9"/><path d="M12 7.5 13.2 3l5.2 1.4" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>', open: 'Open on Reddit' },
  hn: { name: 'Hacker News', short: 'HN', glyph: 'Y', open: 'Open on Hacker News' },
  video: { name: 'Video', glyph: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l10.5-6.5a1 1 0 0 0 0-1.8L9.5 4.6A1 1 0 0 0 8 5.5Z"/></svg>', open: 'Open video' },
  web: { name: 'Web', glyph: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16"/></svg>', open: 'Open link' },
};
const tile = (src, big) => `<span class="tile ${esc(src || 'none')}${big ? ' big' : ''}" title="${esc(SOURCES[src]?.name || 'Loop')}">${SOURCES[src]?.glyph || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>'}</span>`;
const CATEGORY = { ask: ['Asking', 'blue'], complaint: ['Complaint', 'red'], competitor: ['Competitor', 'purple'], mention: ['Mention', 'green'], trend: ['Trend', 'orange'], workflow: ['Workflow', ''], other: ['Other', ''] };
const catBadge = c => c && CATEGORY[c] ? `<span class="badge cat ${CATEGORY[c][1]}">${CATEGORY[c][0]}</span>` : '';

// ---- time ----
const ago = iso => {
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)}d`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
const agoLong = t => { const a = ago(t); return !a ? '' : a === 'now' ? 'just now' : /\d[mhd]$/.test(a) ? `${a.replace('m', ' min').replace('h', ' h').replace('d', ' d')} ago` : a; };
const clock = t => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const dayClock = t => {
  const d = new Date(t), today = new Date(), tomorrow = new Date(Date.now() + 86400000);
  const same = (a, b) => a.toDateString() === b.toDateString();
  return same(d, today) ? clock(t) : same(d, tomorrow) ? `tomorrow ${clock(t)}` : `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${clock(t)}`;
};
const full = iso => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''; };
const compact = n => n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k` : String(n);

// ---- state ----
const S = {
  items: [], loops: [], config: {}, briefings: [], radar: {},
  view: 'inbox', source: 'all', status: 'new', q: '', selected: null, openLoop: null, brief: null,
};
try { Object.assign(S, JSON.parse(localStorage.getItem('radar-view') || '{}')); } catch {}
const remember = () => { try { localStorage.setItem('radar-view', JSON.stringify({ view: S.view, source: S.source, status: S.status })); } catch {} };

const STATUSES = [['new', 'New'], ['saved', 'Saved'], ['replied', 'Replied'], ['dismissed', 'Dismissed'], ['all', 'All']];
const foundAt = it => Date.parse(it.found_at) || 0;
const postedAt = it => Date.parse(it.posted_at) || foundAt(it);
function visible() {
  const q = S.q.trim().toLowerCase();
  return S.items.filter(it =>
    (S.source === 'all' || it.source === S.source) &&
    (S.status === 'all' || it.status === S.status) &&
    (!q || [it.author, it.title, it.text, it.reason, it.author_note, it.topic].some(f => String(f || '').toLowerCase().includes(q))));
}
const sortItems = list => list.sort((a, b) => postedAt(b) - postedAt(a));

// ---- the toolbar ----
function renderToolbar() {
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === S.view));
  $('inboxView').hidden = S.view !== 'inbox';
  $('briefingView').hidden = S.view !== 'briefings';
  $('sources').style.display = S.view === 'inbox' ? '' : 'none';
  document.querySelector('.search').style.display = S.view === 'inbox' ? '' : 'none';
  const present = new Set(S.items.map(i => i.source));
  for (const l of S.loops) if (l.source) present.add(l.source);
  const order = Object.keys(SOURCES).filter(s => present.has(s));
  const newCount = s => S.items.filter(i => i.status === 'new' && (s === 'all' || i.source === s)).length;
  $('sources').innerHTML = ['all', ...order].map(s => {
    const n = newCount(s);
    return `<button data-source="${s}" class="${S.source === s ? 'on' : ''}">${s === 'all' ? 'All' : esc(SOURCES[s].short || SOURCES[s].name)}${n ? ` <span class="n">${n}</span>` : ''}</button>`;
  }).join('');
  $('statuses').innerHTML = STATUSES.map(([k, label]) => `<button data-status="${k}" class="${S.status === k ? 'on' : ''}">${label}</button>`).join('');
}
$('views').onclick = e => { const b = e.target.closest('[data-view]'); if (!b) return; S.view = b.dataset.view; remember(); render(); if (S.view === 'briefings') loadBriefings(); };
$('sources').onclick = e => { const b = e.target.closest('[data-source]'); if (!b) return; S.source = b.dataset.source; remember(); render(); };
$('statuses').onclick = e => { const b = e.target.closest('[data-status]'); if (!b) return; S.status = b.dataset.status; remember(); render(); };
$('q').oninput = e => { S.q = e.target.value; renderList(); };

// ---- the list ----
function itemRow(it) {
  const head = it.title ? `<b>${esc(it.title)}</b> ${esc(it.text || '')}` : esc(it.text || it.url || '');
  return `<button class="item${S.selected === it.id ? ' on' : ''}${it.status === 'new' ? ' is-new' : ''}${['replied', 'dismissed'].includes(it.status) ? ' done' : ''}" data-id="${esc(it.id)}">
    ${it.status === 'new' ? '<span class="unread"></span>' : ''}${tile(it.source)}
    <div class="top"><span class="who">${esc(it.author || SOURCES[it.source]?.name || '')}</span><span class="when" title="${esc(full(it.posted_at || it.found_at))}">${ago(it.posted_at || it.found_at)}</span></div>
    <div class="body">${head}</div>
    ${it.category || it.reason ? `<div class="meta">${catBadge(it.category)}${it.draft ? '<span class="badge blue">Draft</span>' : ''}<span class="why">${esc(it.reason || '')}</span></div>` : ''}
  </button>`;
}
function blankList() {
  if (!S.radar.configured) return `<div class="blank"><div><div class="glyph">${RADAR_GLYPH}</div><b>Tell Scout what to watch</b><p>Scout asks a few questions about what you make and who it's for, then sets up the loops. Posts worth your reply land here.</p><button class="btn primary big" id="startScout">Start with Scout</button></div></div>`;
  if (S.q) return `<div class="blank"><div><b>No matches</b><p>Nothing in this view mentions “${esc(S.q)}”.</p></div></div>`;
  const label = { new: 'Nothing new', saved: 'Nothing saved', replied: 'Nothing replied to yet', dismissed: 'Nothing dismissed', all: 'Nothing yet' }[S.status];
  const next = S.loops.filter(l => l.next_at).sort((a, b) => a.next_at - b.next_at)[0];
  return `<div class="blank"><div><b>${label}</b><p>${S.status === 'new' ? `Scout brings posts here as the loops run.${next ? ` Next: ${esc(next.name)}, ${dayClock(next.next_at)}.` : ''}` : ''}</p></div></div>`;
}
function renderList() {
  const list = sortItems(visible());
  let html = '';
  if (S.status === 'new' || S.status === 'saved') {
    const now = list.filter(i => i.priority === 'now'), later = list.filter(i => i.priority !== 'now');
    if (now.length) html += `<div class="group-h now">Reply now · ${now.length}</div>` + now.map(itemRow).join('');
    if (later.length) html += (now.length ? `<div class="group-h">Later · ${later.length}</div>` : '') + later.map(itemRow).join('');
  } else html = list.map(itemRow).join('');
  $('list').innerHTML = html || blankList();
  const start = $('startScout');
  if (start) start.onclick = () => scout.say('Hi Scout. Help me set up what to watch.');
}
$('list').onclick = e => { const b = e.target.closest('.item'); if (b) select(b.dataset.id); };

// ---- the reader ----
const RADAR_GLYPH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M19.07 4.93A10 10 0 1 0 22 12"/><path d="M16.24 7.76A6 6 0 1 0 18 12"/><circle cx="12" cy="12" r="2"/><path d="m13.4 10.6 6.3-6.3"/></svg>';
const ICONS = {
  open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
  replied: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z"/></svg>',
  dismiss: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="5" rx="1.5"/><path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"/><path d="M10 13h4"/></svg>',
  draft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.4 3.6a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  restore: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
};
const METRIC = { score: 'points', points: 'points', num_comments: 'comments', views: 'views', likes: 'likes', reposts: 'reposts', replies: 'replies', bookmarks: 'bookmarks', followers: 'followers', views_per_follower: '× followers', bookmark_rate: 'bookmarks/1k' };
function renderReader() {
  const it = S.items.find(i => i.id === S.selected);
  if (!it) {
    $('reader').innerHTML = `<div class="blank"><div><div class="glyph">${RADAR_GLYPH}</div><b>${S.items.length ? 'Pick a post' : 'Your inbox'}</b><p>${S.items.length ? 'Select a post to read it, see why Scout kept it, and get a reply drafted.' : 'Posts worth your reply show up here, with why they matter and a draft when you want one.'}</p></div></div>`;
    return;
  }
  const src = SOURCES[it.source] || SOURCES.web;
  const metrics = Object.entries(it.metrics || {}).filter(([k, v]) => METRIC[k] && v != null && v !== 0)
    .map(([k, v]) => `<span class="badge">${k === 'views_per_follower' ? v.toFixed(1) : compact(Math.round(v))} ${METRIC[k]}</span>`).join('');
  const st = it.status;
  const btn = (act, icon, label, on) => `<button class="btn${on ? ' primary' : ''}" data-act="${act}">${ICONS[icon]}${label}</button>`;
  $('reader').innerHTML = `
    <div class="r-actions">
      ${it.url ? `<a class="btn" href="${esc(it.url)}" target="_blank" rel="noopener">${ICONS.open}${esc(src.open)}</a>` : ''}
      <span class="gap"></span>
      ${st === 'new' || st === 'saved' ? `${btn('replied', 'replied', 'Replied')}${st === 'new' ? btn('saved', 'save', 'Save') : ''}${btn('dismissed', 'dismiss', 'Dismiss')}` : btn('new', 'restore', 'Back to inbox')}
    </div>
    <div class="reader-in">
      <div class="r-head">${tile(it.source, true)}
        <div class="r-who"><b>${it.author_url ? `<a href="${esc(it.author_url)}" target="_blank" rel="noopener" style="color:inherit">${esc(it.author || src.name)}</a>` : esc(it.author || src.name)}</b>
        <span>${esc([it.author_note, full(it.posted_at)].filter(Boolean).join(' · '))}</span></div>
      </div>
      ${it.title ? `<h2 class="r-title">${esc(it.title)}</h2>` : ''}
      ${it.text ? `<p class="r-text">${esc(it.text)}</p>` : ''}
      ${metrics ? `<div class="r-metrics">${metrics}</div>` : ''}
      <div class="card-why">
        <div class="h">Why Scout kept it ${catBadge(it.category)}
          <span class="end segmented small prio" title="Priority"><button data-prio="now" class="${it.priority === 'now' ? 'on' : ''}">Now</button><button data-prio="later" class="${it.priority !== 'now' ? 'on' : ''}">Later</button></span></div>
        <p>${esc(it.reason || 'No reason given.')}</p>
        ${it.topic ? `<div class="topic">${esc(it.topic)}</div>` : ''}
      </div>
      ${it.draft ? `<div class="card-draft"><div class="h">Draft reply<span class="end"><button class="btn plain" data-act="copy">${ICONS.copy}Copy</button><button class="btn plain" data-act="redraft">${ICONS.draft}Rewrite</button></span></div><p>${esc(it.draft)}</p></div>`
        : `<div style="margin-top:14px"><button class="btn" data-act="draft">${ICONS.draft}Draft a reply with Scout</button></div>`}
      ${it.note ? `<div class="card-note">${esc(it.note)}</div>` : ''}
    </div>`;
}
$('reader').onclick = async e => {
  const it = S.items.find(i => i.id === S.selected); if (!it) return;
  const p = e.target.closest('[data-prio]');
  if (p) { await post(`/api/items/${encodeURIComponent(it.id)}`, { priority: p.dataset.prio }); return; }
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act;
  if (['replied', 'saved', 'dismissed', 'new'].includes(act)) return setStatus(it, act);
  if (act === 'copy') { await navigator.clipboard.writeText(it.draft).catch(() => {}); b.lastChild.textContent = 'Copied'; setTimeout(() => renderReader(), 1200); }
  if (act === 'draft') scout.say('Draft a reply to this post.');
  if (act === 'redraft') scout.prefill('Rewrite the draft: ');
};
async function setStatus(it, status) {
  const list = sortItems(visible()), i = list.findIndex(x => x.id === it.id);
  await post(`/api/items/${encodeURIComponent(it.id)}`, { status });
  // like Mail: acting on a post moves you to the next one
  if (S.status !== 'all' && S.status !== status) { const next = list[i + 1] || list[i - 1]; S.selected = next && next.id !== it.id ? next.id : null; render(); }
}
function select(id) {
  S.selected = id;
  renderList(); renderReader(); scout.refreshContext();
  $('list').querySelector('.item.on')?.scrollIntoView({ block: 'nearest' });
}

// ---- keyboard: ↑↓ or j k to move, r replied, s save, e dismiss, d draft, o open, / search ----
addEventListener('keydown', e => {
  if (e.target.matches('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey || S.view !== 'inbox') return;
  const list = sortItems(visible()), i = list.findIndex(x => x.id === S.selected), it = list[i];
  const move = d => { const n = list[Math.max(0, Math.min(list.length - 1, i + d))]; if (n) { e.preventDefault(); select(n.id); } };
  if (e.key === 'ArrowDown' || e.key === 'j') move(i < 0 ? 0 : 1);
  else if (e.key === 'ArrowUp' || e.key === 'k') move(-1);
  else if (e.key === '/') { e.preventDefault(); $('q').focus(); }
  else if (!it) return;
  else if (e.key === 'r') setStatus(it, 'replied');
  else if (e.key === 's') setStatus(it, 'saved');
  else if (e.key === 'e' || e.key === 'Backspace') setStatus(it, 'dismissed');
  else if (e.key === 'd') scout.say('Draft a reply to this post.');
  else if (e.key === 'o' && it.url) open(it.url, '_blank', 'noopener');
});

// ---- the loops ----
const OK = '<svg class="ok" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
const BAD = '<svg class="bad" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>';
function loopStatus(l) {
  if (l.running) return `<div class="l3 running"><span class="spinner"></span><span>${esc(l.running.step || 'Running')}</span></div>`;
  if (l.queued) return `<div class="l3"><span>Waiting for the loop ahead</span></div>`;
  if (l.error) return `<div class="l3 blocked">${WARN}<span>${esc(l.error)}</span></div>`;
  if (l.blocked && l.enabled && S.radar.configured) return `<div class="l3 blocked">${WARN}<span>${esc(l.blocked)}</span></div>`;
  const last = l.last;
  const lastLine = last ? `<div class="l3">${last.ok ? OK : BAD}<span>${esc(agoLong(last.ended))} · ${esc(last.summary || (last.ok ? 'Done' : 'Failed'))}</span></div>` : '';
  return lastLine || (l.enabled && l.next_at ? '' : l.enabled && S.radar.configured ? `<div class="l3"><span>Never run</span></div>` : '');
}
function renderLoops() {
  const runningOne = S.loops.find(l => l.running);
  $('loopsState').innerHTML = runningOne ? `<span style="color:var(--orange)">Running</span>` : '';
  const waitingForTopics = !S.radar.configured && S.loops.length ? `<div class="l3 blocked" style="margin:0 0 6px 8px">${WARN}<span>Loops start once Scout knows what to watch.</span></div>` : '';
  $('loops').innerHTML = waitingForTopics + (S.loops.length ? S.loops.map(l => {
    const open = S.openLoop === l.id;
    const next = l.enabled && l.next_at && !l.running ? ` · next ${dayClock(l.next_at)}` : '';
    return `<div class="loop${open ? ' open' : ''}${l.enabled ? '' : ' off'}" data-loop="${esc(l.id)}">
      <div class="l1">${tile(l.source)}<b>${esc(l.name)}</b><button class="switch" role="switch" aria-checked="${l.enabled}" data-toggle="${esc(l.id)}" title="${l.enabled ? 'On' : 'Off'}"></button></div>
      <div class="l2">${esc(l.when)}${esc(next)}</div>
      ${loopStatus(l)}
      ${open ? `<div class="more"><div class="acts">
          ${l.running || l.queued ? `<button class="btn" data-stop="${esc(l.id)}">Stop</button>` : `<button class="btn" data-run="${esc(l.id)}" ${l.error || l.blocked ? 'disabled' : ''}>Run now</button>`}
          <button class="btn" data-ask="${esc(l.id)}">Ask Scout</button></div>
        ${l.runs.length ? l.runs.map(r => `<button class="run" data-log="${esc(r.id)}" data-name="${esc(l.name)}"><i class="${r.stopped ? 'stopped' : r.ok ? '' : 'bad'}"></i><span class="t">${esc(ago(r.ended))}</span><span class="s">${esc(r.summary)}</span></button>`).join('') : '<div class="empty">No runs yet.</div>'}
        </div>` : ''}
    </div>`;
  }).join('') : '<div class="empty">No loops in your Radar folder.</div>');
}
$('loops').onclick = async e => {
  const t = e.target.closest('[data-toggle]');
  if (t) { e.stopPropagation(); const l = S.loops.find(x => x.id === t.dataset.toggle); await post(`/api/loops/${l.id}/enabled`, { enabled: !l.enabled }); return; }
  const run = e.target.closest('[data-run]'); if (run) { e.stopPropagation(); post(`/api/loops/${run.dataset.run}/run`).catch(err => alert(err.message)); return; }
  const stop = e.target.closest('[data-stop]'); if (stop) { e.stopPropagation(); post(`/api/loops/${stop.dataset.stop}/stop`); return; }
  const ask = e.target.closest('[data-ask]'); if (ask) { e.stopPropagation(); const l = S.loops.find(x => x.id === ask.dataset.ask); scout.prefill(`About the ${l.name} loop: `); return; }
  const log = e.target.closest('[data-log]'); if (log) { e.stopPropagation(); showRun(log.dataset.log, log.dataset.name); return; }
  const card = e.target.closest('[data-loop]'); if (card) { S.openLoop = S.openLoop === card.dataset.loop ? null : card.dataset.loop; renderLoops(); }
};
async function showRun(id, name) {
  const lines = await api(`/api/runs/${encodeURIComponent(id)}`);
  const t0 = lines[0]?.at || 0;
  const rel = at => { const s = Math.round((at - t0) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  $('sheet').innerHTML = `<div class="sheet-back"><div class="sheet"><div class="sheet-head"><b>${esc(name)} · ${esc(full(new Date(t0).toISOString()))}</b><button class="icon-btn" data-close>×</button></div><div class="sheet-body">` +
    (lines.map(l => `<div class="log-line ${esc(l.role)} ${esc(l.status || '')}"><span class="k">${rel(l.at)}</span><div>${l.role === 'assistant' ? md(l.text) : esc(l.text)}${l.detail ? `<div class="mono" style="opacity:.8">${esc(l.detail)}</div>` : ''}</div></div>`).join('') || '<div class="empty">This run left no transcript.</div>') +
    '</div></div></div>';
}
$('sheet').onclick = e => { if (e.target.matches('.sheet-back, [data-close]')) $('sheet').innerHTML = ''; };
addEventListener('keydown', e => { if (e.key === 'Escape' && $('sheet').innerHTML) $('sheet').innerHTML = ''; }, true);

// ---- what Radar watches ----
function renderWatching() {
  const c = S.config, w = c.watch || {};
  const topics = c.topics || [];
  if (!topics.length) { $('watching').innerHTML = '<div class="empty">Nothing yet. Scout sets this up with you.</div>'; $('editWatch').textContent = 'Set up'; return; }
  $('editWatch').textContent = 'Change';
  const chips = xs => `<div class="chips">${xs.map(x => `<span class="chip-s">${esc(x)}</span>`).join('')}</div>`;
  const terms = [...(w.names || []), ...(w.phrases || [])];
  $('watching').innerHTML = `<ul class="watch-topics">${topics.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` +
    (terms.length ? `<div class="watch-sub">Terms</div>${chips(terms)}` : '') +
    ((c.reddit?.subreddits || []).length ? `<div class="watch-sub">Subreddits</div>${chips(c.reddit.subreddits.map(s => `r/${s}`))}` : '');
}
$('editWatch').onclick = () => (S.config.topics || []).length ? scout.prefill('Change what you watch: ') : scout.say('Hi Scout. Help me set up what to watch.');
function renderFoot() {
  $('foot').innerHTML = S.radar.home ? `Your Radar folder: <code>${esc(S.radar.home.replace(/^\/(home|Users)\/[^/]+|^\/workspace\/home/, '~'))}</code><br>Loops, what to watch and briefings live there.` : '';
}

// ---- briefings ----
async function loadBriefings() {
  S.briefings = await api('/api/briefings').catch(() => []);
  if (!S.brief || !S.briefings.some(b => b.file === S.brief)) S.brief = S.briefings[0]?.file || null;
  $('briefList').innerHTML = S.briefings.length ? S.briefings.map(b => `<button class="brief-row${b.file === S.brief ? ' on' : ''}" data-brief="${esc(b.file)}"><b>${esc(b.title)}</b><span>${esc(b.file.replace(/\.md$/, ''))}</span></button>`).join('')
    : '<div class="blank"><div><b>No briefings yet</b><p>The Morning briefing loop writes one each day.</p></div></div>';
  if (S.brief) {
    const text = await api(`/api/briefings/${encodeURIComponent(S.brief)}`).catch(() => '');
    $('briefDoc').innerHTML = `<div class="reader-in">${md(String(text).replace(/^# (.+)$/m, '\u0001$1\u0001'), refFor).replace(/\u0001([^\u0001]+)\u0001/, '<h1>$1</h1>')}</div>`;
  } else $('briefDoc').innerHTML = `<div class="blank"><div><div class="glyph">${RADAR_GLYPH}</div><b>Your morning briefing</b><p>What came in, what deserves a reply today, and how the loops are doing, every morning.</p></div></div>`;
}
$('briefList').onclick = e => { const b = e.target.closest('[data-brief]'); if (b) { S.brief = b.dataset.brief; loadBriefings(); } };
$('briefDoc').onclick = e => { const r = e.target.closest('[data-ref]'); if (r) { try { openRef(JSON.parse(r.dataset.ref)); } catch {} } };

// ---- Scout ----
const refFor = text => S.items.some(i => i.id === text) ? { item: text } : null;
function openRef(ref) {
  if (!ref?.item) return;
  const it = S.items.find(i => i.id === ref.item); if (!it) return;
  S.view = 'inbox';
  if (S.status !== 'all' && it.status !== S.status) S.status = 'all';
  if (S.source !== 'all' && it.source !== S.source) S.source = 'all';
  S.q = ''; $('q').value = '';
  remember(); render(); select(it.id);
}
const scout = mountPersona($('persona'), {
  base: '/api/scout', name: 'Scout', role: 'Go-to-market',
  avatar: { color: 'linear-gradient(160deg, #5ac8fa, #007aff 55%, #0040dd)', svg: RADAR_GLYPH.replace('stroke-width="1.8"', 'stroke-width="2.2"') },
  placeholder: 'Ask Scout…',
  hello: {
    text: 'I watch the conversations you care about, bring back the posts worth your reply, and draft them in your voice. I never post anything myself.',
    suggestions: () => (S.config.topics || []).length
      ? ['What deserves a reply today?', 'Draft replies for everything marked now', 'Add a loop for Product Hunt launches']
      : ['Help me set up what to watch', 'What can you watch for me?'],
  },
  context: () => {
    const it = S.view === 'inbox' && S.items.find(i => i.id === S.selected);
    if (it) return { label: `${it.author || SOURCES[it.source]?.name} on ${SOURCES[it.source]?.name || it.source}`, ref: { item: it.id }, item: it.id };
    if (S.view === 'briefings' && S.brief) return { label: `Briefing ${S.brief.replace(/\.md$/, '')}`, ref: null, view: `the briefing ${S.brief}` };
    return null;
  },
  refFor, open: openRef,
});

// ---- load and stay live ----
async function loadItems() { S.items = await api('/api/items'); }
async function loadLoops() { S.loops = (await api('/api/loops')).loops; }
async function loadConfig() { S.config = await api('/api/config').catch(() => ({})); S.radar = await api('/api/radar').catch(() => ({})); }
function render() { renderToolbar(); renderList(); renderReader(); renderLoops(); renderWatching(); renderFoot(); scout.refreshContext(); }
let wasConfigured = null;
const helloFollowsConfig = () => { if (wasConfigured !== S.radar.configured) { wasConfigured = S.radar.configured; scout.rerender(); } };
let pending = null;
const soon = fn => { clearTimeout(pending); pending = setTimeout(fn, 120); };
function live() {
  const es = new EventSource('/api/events');
  es.onmessage = async e => {
    const ev = JSON.parse(e.data);
    if (ev.type === 'items') soon(async () => { await loadItems(); render(); });
    if (ev.type === 'loops') { await loadLoops(); renderLoops(); renderToolbar(); }
    if (ev.type === 'config') { await loadConfig(); render(); helloFollowsConfig(); }
    if (ev.type === 'briefings' && S.view === 'briefings') loadBriefings();
  };
}
await Promise.all([loadItems(), loadLoops(), loadConfig()]);
render();
helloFollowsConfig();
if (S.view === 'briefings') loadBriefings();
live();
setInterval(() => { renderLoops(); }, 30000);            // "2 min ago" keeps up
