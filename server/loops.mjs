// Loops: runbooks in <home>/loops/<id>.md that Scout's workers run on a schedule. A runbook is Markdown with a
// small front matter:
//
//   ---
//   name: Reddit
//   source: reddit                       # the inbox source it fills (x, linkedin, reddit, hn, video, web), if any
//   schedule: 30 6,12,17 * * *           # cron: minute hour day-of-month month day-of-week
//   timezone: America/Los_Angeles        # defaults to the machine's
//   requires: browser                    # optional: what it needs that a machine may not have
//   enabled: true
//   ---
//   What one run does, step by step.
//
// The schedule lives in the file, so changing it is editing a file (or asking Scout to). Whether a loop is on, and
// what each run did, is Cube Scout's state, in <state>/loops.json.
import fs from 'node:fs';
import path from 'node:path';

// ---- front matter: `key: value` lines, a value may be [a, b] or a bare list item; nothing fancier ----
export function parseRunbook(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  const meta = {};
  if (m) {
    let last = null;
    for (const line of m[1].split(/\r?\n/)) {
      const item = /^\s+-\s+(.*)$/.exec(line);
      if (item && last) { meta[last] = [].concat(meta[last] || [], unquote(item[1])); continue; }
      const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*?)\s*(#.*)?$/.exec(line);
      if (!kv) continue;
      last = kv[1];
      let v = kv[2];
      if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map(s => unquote(s.trim())).filter(Boolean);
      else if (v === 'true' || v === 'false') v = v === 'true';
      else v = unquote(v);
      meta[last] = v === '' ? [] : v;
    }
  }
  return { meta, body: m ? text.slice(m[0].length) : text };
}
const unquote = s => s.replace(/^(['"])(.*)\1$/, '$2');

// ---- cron, evaluated in a time zone ----
function field(spec, min, max, names = []) {
  const set = new Set();
  for (let part of String(spec).toLowerCase().split(',')) {
    names.forEach((n, i) => { part = part.replaceAll(n, String(i + min)); });
    const [range, stepS] = part.split('/');
    const step = stepS ? Number(stepS) : 1;
    let lo, hi;
    if (range === '*') { lo = min; hi = max; }
    else if (range.includes('-')) [lo, hi] = range.split('-').map(Number);
    else { lo = Number(range); hi = stepS ? max : lo; }
    if (![lo, hi, step].every(Number.isInteger) || lo < min || hi > max || step < 1) throw new Error(`bad cron field "${spec}"`);
    for (let v = lo; v <= hi; v += step) set.add(v);
  }
  return set;
}
export function parseCron(expr) {
  const f = String(expr).trim().split(/\s+/);
  if (f.length !== 5) throw new Error(`a schedule needs five fields (minute hour day month weekday), got "${expr}"`);
  const dow = field(f[4], 0, 7, ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
  if (dow.has(7)) dow.add(0);
  return { minute: field(f[0], 0, 59), hour: field(f[1], 0, 23), dom: field(f[2], 1, 31), month: field(f[3], 1, 12, ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']), dow, domStar: f[2] === '*', dowStar: f[4] === '*' };
}
const fmtCache = new Map();
function partsIn(tz, t) {
  let f = fmtCache.get(tz);
  if (!f) fmtCache.set(tz, f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' }));
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map(x => [x.type, x.value]));
  return { month: +p.month, day: +p.day, hour: +p.hour % 24, minute: +p.minute, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
// The first minute after `from` the schedule matches, or null within 8 days.
export function nextRun(cron, tz, from = Date.now()) {
  const c = typeof cron === 'string' ? parseCron(cron) : cron;
  let t = Math.floor(from / 60000) * 60000 + 60000;
  for (let i = 0; i < 8 * 24 * 60; i++, t += 60000) {
    const p = partsIn(tz, t);
    if (!c.minute.has(p.minute)) continue;
    if (!c.hour.has(p.hour)) { t += (59 - p.minute) * 60000; continue; }     // skip the rest of the hour
    if (!c.month.has(p.month)) continue;
    const dayOk = c.domStar && c.dowStar ? true : c.domStar ? c.dow.has(p.dow) : c.dowStar ? c.dom.has(p.day) : (c.dom.has(p.day) || c.dow.has(p.dow));
    if (dayOk) return t;
  }
  return null;
}
// "Daily at 6:30, 12:30 and 17:30", "Weekdays at 9:00", "Every 2 hours" — or the expression itself.
export function describeCron(expr) {
  let c;
  try { c = parseCron(expr); } catch { return String(expr); }
  const f = String(expr).trim().split(/\s+/);
  const and = xs => xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0];
  const days = c.domStar && c.dowStar ? 'Daily' : c.domStar && [...c.dow].sort().join() === '1,2,3,4,5' ? 'Weekdays' : c.domStar
    ? `${and([...c.dow].filter(d => d < 7).sort().map(d => ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'][d]))}` : null;
  if (/^\*\/\d+$/.test(f[1]) && /^\d+$/.test(f[0]) && days === 'Daily') return `Every ${f[1].slice(2)} hours`;
  if (f[0].startsWith('*/') && f[1] === '*') return `Every ${f[0].slice(2)} minutes`;
  if (!days || c.hour.size * c.minute.size > 6) return String(expr);
  const times = [];
  for (const h of [...c.hour].sort((a, b) => a - b)) for (const m of [...c.minute].sort((a, b) => a - b)) times.push(`${h}:${String(m).padStart(2, '0')}`);
  return `${days} at ${and(times)}`;
}

// ---- the loops on disk ----
export function readLoops(homeDir, defaultTz) {
  const dir = path.join(homeDir, 'loops');
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('_') && f.toLowerCase() !== 'readme.md').sort(); } catch {}
  return files.map(f => {
    const file = path.join(dir, f), id = f.replace(/\.md$/, '');
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch {}
    const { meta, body } = parseRunbook(text);
    const loop = {
      id, file, body,
      name: meta.name || id,
      source: meta.source || null,
      schedule: meta.schedule || null,
      timezone: meta.timezone || defaultTz || Intl.DateTimeFormat().resolvedOptions().timeZone,
      requires: [].concat(meta.requires || []),
      enabledByDefault: meta.enabled !== false,
      description: meta.description || (body.split('\n').find(l => l.trim() && !l.startsWith('#')) || '').trim().slice(0, 200),
      error: null,
    };
    if (loop.schedule) { try { parseCron(loop.schedule); } catch (e) { loop.error = e.message; } }
    try { Intl.DateTimeFormat('en-US', { timeZone: loop.timezone }); } catch { loop.error = `unknown time zone ${loop.timezone}`; }
    loop.when = loop.schedule ? describeCron(loop.schedule) : 'Only when you run it';
    return loop;
  });
}
