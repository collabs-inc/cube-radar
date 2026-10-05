#!/usr/bin/env node
// Reddit source: every new post in the configured subreddits since --since, matched locally.
//
// Posts come from Arctic Shift (arctic-shift.photon-reddit.com), a public Reddit archive that trails
// live Reddit by a few minutes and needs no login. Its full-text search times out on big subreddits,
// so we list every new post per subreddit and match title + selftext locally.
import {
  emit, finalize, getJson, ignoredAuthors, isoUtc, loadConfig, matcher, parseArgs, parseSince, run, sleep, trimText,
} from "./lib.mjs";

const USAGE = "usage: node tools/reddit.mjs --since <ISO time | 24h | 7d> [--config radar.json] [--out file.json]";
const API = "https://arctic-shift.photon-reddit.com/api/posts/search";
const FIELDS = "id,subreddit,author,title,selftext,created_utc,score,num_comments,url,over_18";
const PAGE = 100;

async function page(sub, after) {
  const q = new URLSearchParams({ subreddit: sub, after: String(after), sort: "asc", limit: String(PAGE), fields: FIELDS });
  const d = await getJson(`${API}?${q}`, {
    label: `arctic-shift r/${sub}`,
    backoffMs: 10e3,
    // The archive answers an overloaded query with 422 {"error":"Timeout. Maybe slow down a bit"}.
    retryStatuses: [422],
  });
  if (d.error) throw new Error(`arctic-shift r/${sub}: ${d.error}`);
  return d.data || [];
}

run(async () => {
  const opts = parseArgs(process.argv.slice(2), USAGE);
  const since = Math.floor(parseSince(opts.since).getTime() / 1000);
  const config = await loadConfig(opts.config);
  const subs = (config.reddit?.subreddits || []).map((s) => String(s).replace(/^\/?r\//i, "")).filter(Boolean);
  if (!subs.length) throw new Error("config has no reddit.subreddits");
  const match = matcher(config);
  const ignored = ignoredAuthors(config);

  const out = [];
  const seen = new Set();
  let scanned = 0;
  for (const sub of subs) {
    let after = since;
    for (;;) {
      const rows = await page(sub, after);
      scanned += rows.length;
      for (const p of rows) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        if (!p.author || p.author === "[deleted]" || p.author === "AutoModerator" || p.over_18 || ignored(p.author)) continue;
        const body = p.selftext || "";
        if (body === "[removed]" || body === "[deleted]" || (p.title || "").startsWith("[ Removed")) continue;
        const hits = match(`${p.title}\n${body}`);
        if (!hits.length) continue;
        out.push({
          id: `reddit:${p.id}`,
          source: "reddit",
          url: `https://www.reddit.com/r/${p.subreddit}/comments/${p.id}/`,
          author: p.author,
          author_url: `https://www.reddit.com/user/${p.author}/`,
          author_note: `r/${p.subreddit}`,
          title: p.title,
          text: trimText(body),
          posted_at: isoUtc(p.created_utc * 1000),
          metrics: { score: p.score ?? null, num_comments: p.num_comments ?? null },
          matched: hits,
        });
      }
      if (rows.length < PAGE) break;
      const next = Math.floor(rows[rows.length - 1].created_utc);
      // A full page within one second would repeat forever; step past it (as the archive's own cursor would).
      after = next > after ? next : after + 1;
      await sleep(1500);
    }
    await sleep(1500);
  }

  const items = finalize(out);
  await emit(items, opts.out);
  process.stderr.write(`${items.length} matches from ${scanned} posts in ${subs.length} subreddits\n`);
});
