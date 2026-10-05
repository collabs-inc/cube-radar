// Radar — watches the conversations you care about and brings back the ones worth your reply.
//   node server/server.mjs           → http://127.0.0.1:$PORT (as a Cube app: behind Cube's gate)
//
// Three columns: Scout (the kit's persona) on the left, the inbox in the middle, the loops on the right. Loops are
// runbooks in <home>/loops/ (loops.mjs) that Radar runs on their schedules, each as a one-off agent session Scout
// supervises: a loop adds posts to the inbox through this server's API, and when it ends Scout hears about it.
//
//   GET  /api/items                      the inbox
//   POST /api/items                      { items: [...] } or [...]: add (a loop's results; never changes your decisions)
//   POST /api/items/<id>                 { status, draft, note, priority }
//   GET  /api/loops                      every loop with its schedule, state, last run and next run
//   POST /api/loops/<id>/run | /stop     run it now, stop its run
//   POST /api/loops/<id>/enabled         { enabled }
//   POST /api/loops/<id>/report          { summary, cursor, added }  a run's own report (the worker calls it)
//   GET  /api/runs/<run id>              a run's transcript
//   GET  /api/config  ·  PUT /api/config the user's radar.json
//   GET  /api/briefings  ·  GET /api/briefings/<file>
//   GET  /api/events                     server-sent events: items, loops, config changed
//   /api/scout/…                         the persona (kit/persona.mjs)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { APP, STATE, home, settings, saveSettings } from './paths.mjs';
import { createStore } from './store.mjs';
import { readLoops, nextRun } from './loops.mjs';
import { createPersona, short } from '../kit/persona.mjs';

const PORT = Number(process.env.PORT || 4321);
const URL_SELF = `http://127.0.0.1:${PORT}`;
fs.mkdirSync(STATE, { recursive: true });
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const fill = text => text.replaceAll('{{APP}}', APP).replaceAll('{{HOME}}', home()).replaceAll('{{STATE}}', STATE).replaceAll('{{URL}}', URL_SELF);
const brief = name => { try { return fill(fs.readFileSync(path.join(APP, 'scout', name), 'utf8')); } catch { return ''; } };
const config = () => readJson(path.join(home(), 'radar.json'), {});

// ---- live updates to the page ----
const clients = new Set();
const broadcast = ev => { const data = `data: ${JSON.stringify(ev)}\n\n`; for (const res of clients) res.write(data); };
const store = createStore(STATE, ids => broadcast({ type: 'items', ids }));

// ---- Scout ----
const scout = createPersona({
  name: 'Scout',
  dir: path.join(STATE, 'scout'),
  cwd: home(),
  brief: () => brief('SCOUT.md'),
  env: () => ({ RADAR_APP: APP, RADAR_HOME: home(), RADAR_STATE: STATE, RADAR_URL: URL_SELF }),
  models: { claude: process.env.RADAR_CLAUDE_MODEL, codex: process.env.RADAR_CODEX_MODEL },
  describe(c) {
    const it = c.item && store.get(c.item);
    if (!it) return c.view ? `[Radar: the user is looking at ${c.view}.]` : '';
    return `[Radar: the user is looking at inbox item ${it.id} (${it.source}${it.author ? `, by ${it.author}` : ''}${it.url ? `, ${it.url}` : ''}). ` +
      `Read it with GET ${URL_SELF}/api/items/${encodeURIComponent(it.id)}.]`;
  },
  eventPrompt: details => `[Radar: you supervise the loops. ${details.length > 1 ? 'These runs ended' : 'A run ended'}:\n` +
    details.map(d => `- ${d}`).join('\n') +
    `\nIf something new deserves a reply now, tell the user in a line or two which posts and why (name the item ids in backticks). ` +
    `If a run failed, say what needs doing, or fix the runbook and run it again. If nothing needs the user, say so in one line.]`,
});

// ---- loops: state, schedule, queue ----
const LOOPS_STATE = path.join(STATE, 'loops.json');
let loopState = readJson(LOOPS_STATE, {});
const saveLoops = () => { const tmp = LOOPS_STATE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(loopState, null, 2)); fs.renameSync(tmp, LOOPS_STATE); };
const stateOf = id => (loopState[id] ||= { runs: [] });
const queue = [];               // loop ids waiting to run
let running = null;             // { loop, runId, started, step, report, work }

// what a loop needs that this machine lacks, in a sentence, or null
function unmet(loop) {
  const cfg = config(), has = [].concat(cfg.capabilities || []);
  if (!(cfg.topics || []).length) return 'Tell Scout what to watch first.';
  for (const r of loop.requires) {
    if (r === 'browser' && !has.includes('browser')) return 'Needs a browser signed in to the site. Add "browser" to capabilities in radar.json once this machine has one.';
  }
  return null;
}
const enabled = loop => stateOf(loop.id).enabled ?? loop.enabledByDefault;

function loopsView() {
  return readLoops(home(), config().timezone).map(loop => {
    const st = stateOf(loop.id);
    const blocked = loop.error || unmet(loop);
    return {
      id: loop.id, name: loop.name, source: loop.source, schedule: loop.schedule, timezone: loop.timezone, when: loop.when,
      description: loop.description, requires: loop.requires, error: loop.error, blocked, enabled: enabled(loop),
      next_at: enabled(loop) && !blocked ? st.next_at || null : null,
      last: st.runs[0] || null, runs: st.runs.slice(0, 12), cursor: st.cursor || null,
      queued: queue.includes(loop.id),
      running: running?.loop.id === loop.id ? { id: running.runId, started: running.started, step: running.step } : null,
    };
  });
}

// every 20 s: plan each loop's next run, and queue the ones that are due (a run missed while the app was down runs
// once on start, never once per missed slot)
function tick() {
  const now = Date.now();
  let dirty = false;
  for (const loop of readLoops(home(), config().timezone)) {
    const st = stateOf(loop.id);
    if (!loop.schedule || loop.error || !enabled(loop) || unmet(loop)) { if (st.next_at) { st.next_at = null; dirty = true; } continue; }
    if (!st.next_at) { st.next_at = nextRun(loop.schedule, loop.timezone, now); st.planned_from = loop.schedule + loop.timezone; dirty = true; continue; }
    if (st.planned_from !== loop.schedule + loop.timezone) { st.next_at = nextRun(loop.schedule, loop.timezone, now); st.planned_from = loop.schedule + loop.timezone; dirty = true; continue; }
    if (st.next_at <= now) {
      st.next_at = nextRun(loop.schedule, loop.timezone, now); dirty = true;
      enqueue(loop.id);
    }
  }
  if (dirty) { saveLoops(); broadcast({ type: 'loops' }); }
}
function enqueue(id) {
  if (running?.loop.id === id || queue.includes(id)) return false;
  queue.push(id); broadcast({ type: 'loops' });
  setImmediate(pump);
  return true;
}

function pump() {
  if (running) return;
  const id = queue.shift();
  if (!id) return;
  const loop = readLoops(home(), config().timezone).find(l => l.id === id);
  if (!loop) return pump();
  const st = stateOf(loop.id);
  const runId = `${loop.id}-${Date.now().toString(36)}`;
  const prompt = [
    `Run the loop "${loop.name}" once, now. Its runbook is ${loop.file}; read it and follow it exactly.`,
    `This loop's id: ${loop.id}. Its last successful run covered up to: ${st.cursor || 'never (this is its first run: look back 24 hours)'}.`,
    `The time now: ${new Date().toISOString()}.`,
    `When you are done, report with POST ${URL_SELF}/api/loops/${loop.id}/report as described in your brief, then stop.`,
  ].join('\n');
  running = { loop, runId, started: Date.now(), step: 'Starting', report: null };
  broadcast({ type: 'loops' });
  running.work = scout.work({
    id: runId, prompt, brief: brief('LOOP.md'), cwd: home(),
    env: { RADAR_LOOP: loop.id, RADAR_RUN: runId },
    onUpdate: u => { if (u.step && running) { running.step = u.step; broadcast({ type: 'loops' }); } },
  });
  running.work.promise.then(result => {
    const r = running; running = null;
    const report = r.report || {};
    const reported = Boolean(r.report);
    const ok = reported ? !report.error : result.ok;
    if (r.ended_by_report) result.stopped = false;
    const summary = short(report.summary || (ok ? (result.summary.split('\n').filter(Boolean).pop() || 'Done') : result.error || 'Failed'), 300);
    const record = { id: r.runId, started: r.started, ended: Date.now(), ok, stopped: Boolean(result.stopped), summary, added: report.added ?? null, agent: result.agent };
    st.runs.unshift(record); st.runs = st.runs.slice(0, 30);
    if (ok && report.cursor) st.cursor = report.cursor;
    saveLoops(); broadcast({ type: 'loops' });
    if (!result.stopped) {
      const fresh = store.all().filter(i => i.loop === loop.id && Date.parse(i.found_at) >= r.started);
      const now = fresh.filter(i => i.priority === 'now' && i.status === 'new');
      scout.event(`${loop.name}: ${summary}`,
        `${loop.name} (${loop.id}) ${ok ? 'finished' : 'FAILED'} after ${Math.max(1, Math.round((record.ended - r.started) / 60000))} min: ${summary}` +
        `${fresh.length ? `. New in the inbox: ${fresh.map(i => `${i.id}${i.priority === 'now' ? ' (now)' : ''}`).join(', ')}` : ''}` +
        `${!ok ? `. Its transcript: GET ${URL_SELF}/api/runs/${r.runId}` : ''}`,
        { ref: now.length ? { item: now[0].id } : null });
    }
    pump();
  });
}

setInterval(tick, 20000);
setTimeout(tick, 1500);

// ---- briefings: Markdown files in <home>/briefings, newest first ----
function briefings() {
  const dir = path.join(home(), 'briefings');
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md')); } catch {}
  return files.map(f => ({ file: f, title: (fs.readFileSync(path.join(dir, f), 'utf8').match(/^#\s+(.+)$/m) || [])[1] || f.replace(/\.md$/, ''), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.file.localeCompare(a.file));
}

// ---- http ----
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
function body(req, res, fn, limit = 2e6) {
  let raw = '';
  req.on('data', d => { raw += d; if (raw.length > limit) { send(res, 413, { error: 'too large' }); req.destroy(); } });
  req.on('end', () => {
    let b; try { b = JSON.parse(raw || '{}'); } catch (e) { return send(res, 400, { error: `not JSON: ${e.message}` }); }
    try { fn(b); } catch (e) { send(res, 400, { error: e.message }); }
  });
}
function serveStatic(res, p) {
  const rel = p === '/' ? '/web/index.html' : p;
  if (!/^\/(web|kit)\//.test(rel)) return send(res, 404, 'not found', 'text/plain');
  const f = path.join(APP, rel);
  if (!f.startsWith(APP + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(res, 404, 'not found', 'text/plain');
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
}

function route(req, res) {
  const url = new URL(req.url, 'http://x');
  let p; try { p = decodeURIComponent(url.pathname); } catch { return send(res, 400, 'bad url', 'text/plain'); }
  if (scout.route(req, res, p, '/api/scout', { body, send })) return;
  if (p === '/api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(': hi\n\n'); clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }
  if (p === '/api/radar') return send(res, 200, { home: home(), state: STATE, app: APP, scout: scout.status(), configured: (config().topics || []).length > 0 });
  if (p === '/api/items' && req.method === 'GET') return send(res, 200, store.all());
  if (p === '/api/items' && req.method === 'POST') return body(req, res, b => {
    const list = Array.isArray(b) ? b : b.items;
    if (!Array.isArray(list)) throw new Error('send { "items": [...] } or a JSON array');
    const loop = (running && (b.loop || process.env.RADAR_LOOP)) || b.loop || null;
    send(res, 200, store.add(list, loop));
  });
  if (p === '/api/items/known' && req.method === 'POST') return body(req, res, b => send(res, 200, { known: [].concat(b.ids || []).filter(id => store.has(String(id))) }));
  const item = /^\/api\/items\/(.+)$/.exec(p);
  if (item && req.method === 'GET') { const it = store.get(item[1]); return it ? send(res, 200, it) : send(res, 404, { error: 'no such item' }); }
  if (item && req.method === 'POST') return body(req, res, b => send(res, 200, store.update(item[1], b)));
  if (p === '/api/loops') return send(res, 200, { loops: loopsView(), queue, running: running ? { loop: running.loop.id, id: running.runId } : null });
  const lp = /^\/api\/loops\/([\w.-]+)\/(run|stop|enabled|report)$/.exec(p);
  if (lp && req.method === 'POST') {
    const [, id, what] = lp, loop = readLoops(home(), config().timezone).find(l => l.id === id);
    if (!loop) return send(res, 404, { error: 'no such loop' });
    if (what === 'run') {
      const why = loop.error || unmet(loop);
      if (why) return send(res, 409, { error: why });
      return send(res, 200, { queued: enqueue(id) });
    }
    if (what === 'stop') {
      const q = queue.indexOf(id); if (q >= 0) queue.splice(q, 1);
      if (running?.loop.id === id) running.work.stop();
      broadcast({ type: 'loops' });
      return send(res, 200, { ok: true });
    }
    if (what === 'enabled') return body(req, res, b => {
      stateOf(id).enabled = Boolean(b.enabled); stateOf(id).next_at = null; saveLoops(); tick(); broadcast({ type: 'loops' });
      send(res, 200, { enabled: Boolean(b.enabled) });
    });
    if (what === 'report') return body(req, res, b => {
      if (running?.loop.id !== id) return send(res, 409, { error: `${id} is not running` });
      running.report = { summary: short(b.summary, 300), cursor: b.cursor ? new Date(b.cursor).toISOString() : null, added: Number.isFinite(b.added) ? b.added : null, error: b.error ? short(b.error, 600) : null };
      // a run is over once it has reported; a session that lingers (a background command it left running) is ended
      const r = running;
      setTimeout(() => { if (running === r) { r.ended_by_report = true; r.work.stop(); } }, 60000);
      send(res, 200, { ok: true });
    });
  }
  const run = /^\/api\/runs\/([\w.-]+)$/.exec(p);
  if (run) return send(res, 200, scout.readRun(run[1]));
  if (p === '/api/config' && req.method === 'GET') return send(res, 200, config());
  if (p === '/api/config' && req.method === 'PUT') return body(req, res, b => {
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Error('radar.json must be an object');
    const f = path.join(home(), 'radar.json'), tmp = f + '.tmp';
    fs.mkdirSync(home(), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(b, null, 2) + '\n'); fs.renameSync(tmp, f);
    broadcast({ type: 'config' }); tick();
    send(res, 200, b);
  });
  if (p === '/api/briefings') return send(res, 200, briefings());
  const br = /^\/api\/briefings\/([^/]+\.md)$/.exec(p);
  if (br) { try { return send(res, 200, fs.readFileSync(path.join(home(), 'briefings', path.basename(br[1])), 'utf8'), 'text/markdown; charset=utf-8'); } catch { return send(res, 404, { error: 'no such briefing' }); } }
  if (p === '/api/settings' && req.method === 'POST') return body(req, res, b => {
    if (b.home) { if (!fs.existsSync(String(b.home).replace(/^~/, process.env.HOME || ''))) throw new Error('no such folder'); saveSettings({ home: b.home }); }
    loopState = readJson(LOOPS_STATE, {}); broadcast({ type: 'config' }); broadcast({ type: 'loops' });
    send(res, 200, { ...settings(), home: home() });
  });
  if (p.startsWith('/api/')) return send(res, 404, { error: 'unknown endpoint' });
  serveStatic(res, p);
}

// a loop's runbook or radar.json edited by hand (or by Scout) shows up without a reload
let watchers = [];
function watchHome() {
  for (const w of watchers) w.close();
  watchers = [];
  for (const [dir, type] of [[path.join(home(), 'loops'), 'loops'], [home(), 'config'], [path.join(home(), 'briefings'), 'briefings']]) {
    try { watchers.push(fs.watch(dir, () => { broadcast({ type }); if (type === 'loops') tick(); })); } catch {}
  }
}
watchHome();
setInterval(watchHome, 60000);   // folders created after start

http.createServer((req, res) => {
  try { route(req, res); } catch (e) { console.error('radar:', e); if (!res.headersSent) send(res, 500, { error: String(e.message || e) }); else res.destroy(); }
}).listen(PORT, '127.0.0.1', () => console.log(`Radar → ${URL_SELF}  (home ${home()})`));
process.on('uncaughtException', e => console.error('radar: uncaught', e));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { store.flush(); if (running) running.work.stop(); scout.shutdown(); process.exit(0); });
