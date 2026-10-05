// The inbox: every post a loop kept, in <state>/items.json, keyed "<source>:<native id>".
//
// A loop adds items; it never changes what you decided. Adding an item that exists only fills fields it lacks, so
// a status, a draft or a note you set survives every later run. You (and Scout) change an item with update().
import fs from 'node:fs';
import path from 'node:path';

export const SOURCES = ['x', 'linkedin', 'reddit', 'hn', 'video', 'web'];
export const STATUSES = ['new', 'saved', 'replied', 'dismissed'];
export const PRIORITIES = ['now', 'later'];
const TEXT_MAX = 6000, FIELD_MAX = 600;

const str = (v, n = FIELD_MAX) => (v == null ? undefined : String(v).slice(0, n));
const iso = v => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : undefined; };
const httpUrl = v => { try { const u = new URL(String(v)); return /^https?:$/.test(u.protocol) ? u.href : undefined; } catch { return undefined; } };

// One item as a loop or Scout sent it, cleaned: known fields only, bounded, URLs that are web links.
export function clean(x) {
  if (!x || typeof x !== 'object') throw new Error('an item must be an object');
  const id = str(x.id, 200);
  if (!id || !/^[a-z]+:.+/.test(id)) throw new Error(`item id must look like "<source>:<id>", got ${JSON.stringify(x.id)}`);
  const source = SOURCES.includes(x.source) ? x.source : (SOURCES.includes(id.split(':')[0]) ? id.split(':')[0] : 'web');
  const metrics = {};
  if (x.metrics && typeof x.metrics === 'object') for (const [k, v] of Object.entries(x.metrics).slice(0, 16)) if (Number.isFinite(Number(v)) && v !== null) metrics[str(k, 40)] = Number(v);
  const out = {
    id, source, url: httpUrl(x.url),
    author: str(x.author, 200), author_url: httpUrl(x.author_url), author_note: str(x.author_note, 300),
    title: str(x.title, 500), text: str(x.text, TEXT_MAX), posted_at: iso(x.posted_at),
    metrics, matched: Array.isArray(x.matched) ? x.matched.slice(0, 12).map(m => str(m, 80)) : undefined,
    topic: str(x.topic, 120), category: str(x.category, 40), reason: str(x.reason, 1200),
    priority: PRIORITIES.includes(x.priority) ? x.priority : undefined,
    status: STATUSES.includes(x.status) ? x.status : undefined,
    draft: str(x.draft, 4000), note: str(x.note, 2000), loop: str(x.loop, 80),
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

export function createStore(STATE, onChange = () => {}) {
  const FILE = path.join(STATE, 'items.json');
  let items = {};
  try { items = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
  let timer = null;
  const persist = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      fs.mkdirSync(STATE, { recursive: true });
      const tmp = FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(items));
      fs.renameSync(tmp, FILE);                       // never a half-written inbox
    }, 150);
  };
  const changed = ids => { persist(); onChange(ids); };

  return {
    get: id => items[id] || null,
    all: () => Object.values(items),
    // add from a loop: new items are "new"; existing ones only gain the fields they lack
    add(list, loop) {
      const added = [], existed = [], errors = [];
      for (const raw of [].concat(list)) {
        let x;
        try { x = clean(raw); } catch (e) { errors.push(e.message); continue; }
        const old = items[x.id];
        if (old) {
          for (const [k, v] of Object.entries(x)) if (old[k] === undefined && k !== 'status') old[k] = v;
          existed.push(x.id);
        } else {
          items[x.id] = { priority: 'later', ...x, status: 'new', loop: x.loop || loop || undefined, found_at: new Date().toISOString() };
          added.push(x.id);
        }
      }
      if (added.length || existed.length) changed([...added, ...existed]);
      return { added, existed, errors };
    },
    // a change you (or Scout on your behalf) make: status, draft, note, priority
    update(id, patch) {
      const it = items[id];
      if (!it) throw new Error('no such item');
      if (patch.status !== undefined) {
        if (!STATUSES.includes(patch.status)) throw new Error(`status must be one of ${STATUSES.join(', ')}`);
        it.status = patch.status; it.status_at = new Date().toISOString();
      }
      if (patch.priority !== undefined && PRIORITIES.includes(patch.priority)) it.priority = patch.priority;
      for (const k of ['draft', 'note', 'reason', 'category']) if (patch[k] !== undefined) it[k] = str(patch[k], k === 'draft' ? 4000 : 2000) || undefined;
      changed([id]);
      return it;
    },
    has: id => Boolean(items[id]),
    flush() { clearTimeout(timer); fs.mkdirSync(STATE, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(items)); },
  };
}
