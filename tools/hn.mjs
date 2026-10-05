#!/usr/bin/env node
// Hacker News source: stories and comments since --since, via the public Algolia HN API.
//
// Algolia is queried once per term: every watch name and phrase, plus every term of the FIRST
// all_of group (any all_of hit must contain one of those). Every hit is then re-checked locally
// with the full matcher, so Algolia's fuzzy/prefix matching never decides what counts.
import {
  FetchError, emit, finalize, getJson, ignoredAuthors, isoUtc, loadConfig, matcher, parseArgs, parseSince, run, sleep,
  stripHtml, trimText,
} from "./lib.mjs";

const USAGE = "usage: node tools/hn.mjs --since <ISO time | 24h | 7d> [--config radar.json] [--out file.json]";
const API = "https://hn.algolia.com/api/v1/search_by_date";
const PER_PAGE = 100;
const MAX_PAGES = 30; // per term; beyond this the term is too broad for the window and we refuse a partial result

/** Every hit for one term created after `since`, walking back in time (Algolia caps page-based paging at 1000). */
async function hitsFor(term, since) {
  const query = /\s/.test(term.trim()) ? `"${term.trim()}"` : term.trim();
  const hits = [];
  let upper = null;
  for (let pageNo = 0; ; pageNo++) {
    if (pageNo >= MAX_PAGES) {
      throw new FetchError(`hn "${term}": more than ${MAX_PAGES * PER_PAGE} hits since ${isoUtc(since * 1000)}; narrow --since or make the term more specific`);
    }
    const filters = [`created_at_i>${since}`];
    if (upper !== null) filters.push(`created_at_i<=${upper}`);
    const q = new URLSearchParams({ query, tags: "(story,comment)", numericFilters: filters.join(","), hitsPerPage: String(PER_PAGE) });
    const d = await getJson(`${API}?${q}`, { label: `hn algolia "${term}"` });
    const page = d.hits || [];
    hits.push(...page);
    if (page.length < PER_PAGE) return hits;
    const oldest = Math.min(...page.map((h) => h.created_at_i));
    // `<=` re-reads the boundary second (dupes are dropped later); if a whole page shares it, step past.
    upper = upper === oldest ? oldest - 1 : oldest;
    await sleep(250);
  }
}

run(async () => {
  const opts = parseArgs(process.argv.slice(2), USAGE);
  const since = Math.floor(parseSince(opts.since).getTime() / 1000);
  const config = await loadConfig(opts.config);
  const w = config.watch || {};
  const clean = (a) => (Array.isArray(a) ? a.filter((t) => typeof t === "string" && t.trim()) : []);
  const firstGroup = Array.isArray(w.all_of) && w.all_of.length ? clean(w.all_of[0]) : [];
  const terms = [...new Set([...clean(w.names), ...clean(w.phrases), ...firstGroup].map((t) => t.trim().toLowerCase()))];
  if (!terms.length) throw new Error("config watch has no names, phrases or all_of terms");
  const minPoints = Number(config.hn?.min_points) || 0;
  const match = matcher(config);
  const ignored = ignoredAuthors(config);

  const byId = new Map();
  for (const term of terms) {
    for (const h of await hitsFor(term, since)) byId.set(h.objectID, h);
    await sleep(250);
  }

  const out = [];
  for (const h of byId.values()) {
    if (!h.author || ignored(h.author)) continue;
    const isComment = (h._tags || []).includes("comment");
    let title, text, hits;
    if (isComment) {
      text = stripHtml(h.comment_text);
      if (!text || text === "[dead]" || text === "[flagged]") continue;
      title = `Comment on: ${h.story_title || "(unknown story)"}`;
      hits = match(text);
    } else {
      if ((h.points ?? 0) < minPoints) continue;
      title = h.title || "";
      text = stripHtml(h.story_text);
      hits = match([title, text, h.url || ""].join("\n"));
    }
    if (!hits.length) continue;
    out.push({
      id: `hn:${h.objectID}`,
      source: "hn",
      url: `https://news.ycombinator.com/item?id=${h.objectID}`,
      author: h.author,
      author_url: `https://news.ycombinator.com/user?id=${encodeURIComponent(h.author)}`,
      author_note: isComment ? "HN comment" : "HN story",
      title,
      text: trimText(text || (isComment ? "" : h.url || "")),
      posted_at: isoUtc(h.created_at_i * 1000),
      metrics: isComment
        ? { points: h.points ?? null, num_comments: null, story_id: h.story_id ?? null }
        : { points: h.points ?? null, num_comments: h.num_comments ?? null },
      matched: hits,
    });
  }

  const items = finalize(out);
  await emit(items, opts.out);
  process.stderr.write(`${items.length} matches from ${byId.size} hits for ${terms.length} terms on Hacker News\n`);
});
