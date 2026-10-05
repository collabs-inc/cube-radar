// Shared helpers for the cube-radar source fetchers. No dependencies: Node >= 20, built-in fetch.
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const USER_AGENT = "cube-radar/0.1";
export const TEXT_LIMIT = 2000;

/** A failure that must stop the run: the caller must not advance its last-run time. */
export class FetchError extends Error {}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Parse --since: an ISO time, or a relative window like 30m, 24h, 7d, 2w.
 * Returns a Date. Throws on anything else.
 */
export function parseSince(s, now = Date.now()) {
  if (typeof s !== "string" || !s.trim()) throw new Error("--since is required (ISO time, or e.g. 24h / 7d)");
  const m = /^(\d+(?:\.\d+)?)([mhdw])$/.exec(s.trim());
  if (m) {
    const unit = { m: 60e3, h: 3600e3, d: 86400e3, w: 604800e3 }[m[2]];
    return new Date(now - Number(m[1]) * unit);
  }
  // A bare date or a date-time without an offset is read as UTC, not local time.
  let iso = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) iso += "T00:00:00Z";
  else if (/^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(iso)) iso += "Z";
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) throw new Error(`--since: not an ISO time or a window like 24h / 7d: ${s}`);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`--since: not an ISO time or a window like 24h / 7d: ${s}`);
  return d;
}

/** Parse `--since X [--config P] [--out F] [positional...]`. */
export function parseArgs(argv, usage) {
  const opts = { since: null, config: null, out: null, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [flag, inline] = a.startsWith("--") && a.includes("=") ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] : [a, null];
    const value = () => {
      if (inline !== null) return inline;
      if (i + 1 >= argv.length) die(`${flag} needs a value\n${usage}`);
      return argv[++i];
    };
    if (flag === "--since") opts.since = value();
    else if (flag === "--config") opts.config = value();
    else if (flag === "--out") opts.out = value();
    else if (flag === "-h" || flag === "--help") { process.stdout.write(usage + "\n"); process.exit(0); }
    else if (flag === "--") { opts.positional.push(...argv.slice(i + 1)); break; }
    else if (a.startsWith("--")) die(`unknown option ${a}\n${usage}`);
    else opts.positional.push(a);
  }
  if (!opts.since) die(`--since is required\n${usage}`);
  return opts;
}

export function defaultConfigPath(env = process.env) {
  return env.RADAR_HOME ? join(env.RADAR_HOME, "radar.json") : join(homedir(), "Radar", "radar.json");
}

export async function loadConfig(path) {
  const p = path || defaultConfigPath();
  let raw;
  try {
    raw = await readFile(p, "utf8");
  } catch (e) {
    throw new Error(`cannot read config ${p}: ${e.code || e.message} (pass --config, or set RADAR_HOME)`);
  }
  try {
    const c = JSON.parse(raw);
    if (!c || typeof c !== "object" || Array.isArray(c)) throw new Error("top level must be an object");
    return c;
  } catch (e) {
    throw new Error(`config ${p} is not valid JSON: ${e.message}`);
  }
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One term -> a case-insensitive, word-bounded regex; whitespace in the term matches any whitespace. */
export function termRegex(term) {
  const body = term.trim().split(/\s+/).map(escapeRe).join("\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, "iu");
}

const strings = (v) => (Array.isArray(v) ? v.filter((t) => typeof t === "string" && t.trim()) : []);

/**
 * Build a matcher from config.watch. Returns `text => string[]`: the matched terms (empty = no match).
 * A text matches if any name, any phrase, or every all_of group (at least one term each) matches.
 */
export function matcher(config) {
  const w = (config && config.watch) || {};
  const anywhere = [...strings(w.names), ...strings(w.phrases)].map((t) => [t, termRegex(t)]);
  const groups = (Array.isArray(w.all_of) ? w.all_of : [])
    .map(strings)
    .filter((g) => g.length)
    .map((g) => g.map((t) => [t, termRegex(t)]));
  return (text) => {
    const t = text || "";
    const hits = anywhere.filter(([, re]) => re.test(t)).map(([term]) => term);
    if (groups.length) {
      const perGroup = groups.map((g) => g.filter(([, re]) => re.test(t)).map(([term]) => term));
      if (perGroup.every((g) => g.length)) hits.push(...perGroup.flat());
    }
    return [...new Set(hits)];
  };
}

/** Lower-cased set of ignored authors; `isIgnored(name)`. */
export function ignoredAuthors(config) {
  const set = new Set(strings(config && config.ignore_authors).map((a) => a.replace(/^@/, "").toLowerCase()));
  return (name) => !!name && set.has(String(name).replace(/^@/, "").toLowerCase());
}

const RETRYABLE = (status) => status === 408 || status === 429 || status >= 500;
const snippet = async (res) => {
  try {
    const t = (await res.text()).replace(/\s+/g, " ").trim();
    return t ? ` ${t.slice(0, 200)}` : "";
  } catch {
    return "";
  }
};

/**
 * GET with a 60 s timeout, retrying network errors, timeouts, 408/429 and 5xx with backoff.
 * `retryStatuses` adds source-specific transient statuses. Other HTTP errors throw at once
 * (error.status is set). Returns the Response body as text.
 */
export async function getText(url, { accept, tries = 3, backoffMs = 5000, timeoutMs = 60e3, label, retryStatuses = [] } = {}) {
  const retryable = (status) => RETRYABLE(status) || retryStatuses.includes(status);
  const headers = { "User-Agent": USER_AGENT };
  if (accept) headers.Accept = accept;
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return await res.text();
      const err = new FetchError(`${label || url}: HTTP ${res.status}${await snippet(res)}`);
      err.status = res.status;
      if (!retryable(res.status)) throw err;
      last = err;
      const retryAfter = Number(res.headers.get("retry-after"));
      if (i < tries - 1) await sleep(retryAfter > 0 && retryAfter < 120 ? retryAfter * 1000 : backoffMs * (i + 1));
    } catch (e) {
      if (e instanceof FetchError && !retryable(e.status)) throw e;
      if (!(e instanceof FetchError)) {
        const why = e.name === "TimeoutError" ? `timed out after ${timeoutMs / 1000}s` : e.cause?.code || e.message;
        last = new FetchError(`${label || url}: ${why}`);
        if (i < tries - 1) await sleep(backoffMs * (i + 1));
      }
    }
  }
  throw new FetchError(`${last.message} (gave up after ${tries} tries)`);
}

export async function getJson(url, opts = {}) {
  const text = await getText(url, opts);
  try {
    return JSON.parse(text);
  } catch {
    throw new FetchError(`${opts.label || url}: response is not JSON`);
  }
}

export const trimText = (s) => {
  const t = (s || "").trim();
  return t.length > TEXT_LIMIT ? t.slice(0, TEXT_LIMIT - 1) + "…" : t;
};

export const isoUtc = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, "Z");

/** Strip HTML tags and decode the entities HN and friends use. */
export function stripHtml(html) {
  return (html || "")
    .replace(/<p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

/** Dedupe by id (first wins) and sort newest first. */
export function finalize(items) {
  const seen = new Set();
  return items
    .filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true)))
    .sort((a, b) => (a.posted_at < b.posted_at ? 1 : a.posted_at > b.posted_at ? -1 : 0));
}

export async function emit(items, out) {
  const text = JSON.stringify(items, null, 1) + "\n";
  if (out) await writeFile(out, text);
  else process.stdout.write(text);
}

export function die(msg, code = 2) {
  process.stderr.write(msg.endsWith("\n") ? msg : msg + "\n");
  process.exit(code);
}

/** Run a fetcher's main; any thrown error exits non-zero and writes nothing. */
export function run(main) {
  main().catch((e) => {
    const msg = e instanceof FetchError ? `fetch failed, nothing written: ${e.message}` : `error, nothing written: ${e.message}`;
    die(msg, 1);
  });
}
