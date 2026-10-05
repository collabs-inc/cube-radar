#!/usr/bin/env node
// Video source: launch/demo videos on X that are doing well, since --since.
//
// usage: node tools/video.mjs --since 3d [--config radar.json] [--out f.json] [lead tweet URLs...]
//
// Sources, no browser or X login needed:
// - What Ships (whatships.com), a human-curated directory of startup launch videos posted on X.
//   Its /search-index.json lists every entry newest first; each /videos/<slug>/ page (as Markdown)
//   gives the date, category, duration and the original X post.
// - api.fxtwitter.com gives each post's public counts (views, likes, reposts, bookmarks) and the
//   author's follower count.
// Lead URLs (tweet URLs found elsewhere) are enriched the same way and always kept.
//
// A What Ships entry is kept when it passes any configured threshold (video.min_views,
// video.min_views_per_follower, video.min_bookmark_rate) or the watch matcher hits its text.
import {
  FetchError, emit, finalize, getJson, getText, ignoredAuthors, isoUtc, loadConfig, matcher, parseArgs, parseSince, run,
  sleep, trimText,
} from "./lib.mjs";

const USAGE = "usage: node tools/video.mjs --since <ISO time | 24h | 7d> [--config radar.json] [--out file.json] [lead tweet URLs...]";
const SITE = "https://whatships.com";
const MAX_ENTRIES = 150; // stop walking the index after this many entries
const STATUS_RE = /(?:x|twitter)\.com\/([A-Za-z0-9_]+)\/status\/(\d+)/;
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

const notFound = (e) => e instanceof FetchError && (e.status === 404 || e.status === 410);

async function whatshipsEntry(slug) {
  const md = await getText(`${SITE}/videos/${slug}/`, { accept: "text/markdown", label: `whatships ${slug}`, backoffMs: 2000 });
  const field = (k) => (new RegExp(`^- ${k}: (.+)$`, "m").exec(md) || [])[1]?.trim() ?? null;
  const lines = md.split("\n");
  const status = /https:\/\/x\.com\/([A-Za-z0-9_]+)\/status\/(\d+)/.exec(md);
  const description = lines.slice(1).find((l) => l.trim() && !l.startsWith("- ")) || "";
  return {
    slug,
    title: lines[0].replace(/^#+\s*/, "").trim(),
    description: description.trim(),
    product: field("Product"),
    company: field("Company"),
    category: field("Category"),
    published: field("Published"),
    duration: field("Duration"),
    tags: (field("Tags") || "").split(",").map((t) => t.trim()).filter(Boolean),
    x_url: status ? status[0] : null,
    directory_url: `${SITE}/videos/${slug}/`,
    poster_url: `${SITE}/posters/${slug}-960.webp`,
  };
}

/** "Oct 4, 2026" -> Date (UTC midnight), or null. */
function parsePublished(s) {
  const m = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/.exec(s || "");
  return m && m[1] in MONTHS ? new Date(Date.UTC(Number(m[3]), MONTHS[m[1]], Number(m[2]))) : null;
}

async function xStats(url) {
  const m = STATUS_RE.exec(url || "");
  if (!m) return null;
  const d = (await getJson(`https://api.fxtwitter.com/${m[1]}/status/${m[2]}`, { label: `fxtwitter ${m[1]}/${m[2]}`, backoffMs: 2000 })).tweet;
  if (!d) throw new FetchError(`fxtwitter ${m[1]}/${m[2]}: no tweet in response`);
  const vids = d.media?.videos || [];
  const created = d.created_timestamp ? new Date(d.created_timestamp * 1000) : new Date(d.created_at);
  return {
    tweet_id: String(d.id),
    x_url: `https://x.com/${d.author.screen_name}/status/${d.id}`,
    author: d.author.screen_name,
    author_name: d.author.name ?? null,
    followers: d.author.followers || 0,
    text: d.text || "",
    posted_at: isoUtc(created),
    views: d.views || 0,
    likes: d.likes || 0,
    reposts: d.retweets || 0,
    replies: d.replies || 0,
    bookmarks: d.bookmarks || 0,
    video_seconds: vids[0]?.duration ? Math.round(vids[0].duration) : null,
    has_video: vids.length > 0,
  };
}

function ratios(s, now) {
  const ageH = Math.max(1, (now - Date.parse(s.posted_at)) / 3600e3);
  const r2 = (x) => Math.round(x * 100) / 100;
  return {
    age_hours: Math.round(ageH),
    views_per_hour: Math.round(s.views / ageH),
    // How far past its own audience a post travelled: >1 means it reached well beyond followers.
    views_per_follower: r2(s.views / Math.max(s.followers, 1)),
    // Bookmarks per 1k views; null when X reports no views (old posts), where the ratio means nothing.
    bookmark_rate: s.views > 0 ? r2((1000 * s.bookmarks) / s.views) : null,
  };
}

function candidate(s, e, via, now, matched) {
  const r = ratios(s, now);
  return {
    id: `video:${s.tweet_id}`,
    source: "video",
    url: s.x_url,
    author: s.author,
    author_url: `https://x.com/${s.author}`,
    author_note: `${s.author_name || s.author} · ${s.followers.toLocaleString("en-US")} followers on X`,
    title: e?.title || s.text.split("\n")[0].slice(0, 140),
    text: trimText(s.text),
    posted_at: s.posted_at,
    metrics: {
      views: s.views, likes: s.likes, reposts: s.reposts, replies: s.replies, bookmarks: s.bookmarks,
      followers: s.followers, video_seconds: s.video_seconds, ...r,
    },
    matched,
    details: {
      via, author_name: s.author_name, has_video: s.has_video,
      ...(e && {
        product: e.product, company: e.company, category: e.category, published: e.published, duration: e.duration,
        tags: e.tags, directory_url: e.directory_url, poster_url: e.poster_url,
      }),
    },
  };
}

run(async () => {
  const opts = parseArgs(process.argv.slice(2), USAGE);
  const since = parseSince(opts.since);
  const config = await loadConfig(opts.config);
  const v = config.video || {};
  const categories = new Set((v.categories || []).map((c) => String(c).toLowerCase()));
  const tagHints = (v.tag_hints || []).map((t) => String(t).toLowerCase());
  const thresholds = [
    ["views", Number(v.min_views)],
    ["views_per_follower", Number(v.min_views_per_follower)],
    ["bookmark_rate", Number(v.min_bookmark_rate)],
  ].filter(([, n]) => n > 0);
  const match = matcher(config);
  const ignored = ignoredAuthors(config);
  const now = Date.now();
  const leads = opts.positional;
  for (const l of leads) if (!STATUS_RE.test(l)) throw new Error(`not a tweet URL: ${l}`);

  const out = [];
  const skipped = [];
  let scanned = 0;
  let enriched = 0;

  const index = await getJson(`${SITE}/search-index.json`, { label: "whatships index" });
  if (!Array.isArray(index)) throw new FetchError("whatships index: unexpected shape");
  const entries = index.filter((x) => x.kind === "video").slice(0, MAX_ENTRIES);
  for (const it of entries) {
    let e;
    try {
      e = await whatshipsEntry(it.slug);
    } catch (err) {
      if (notFound(err)) { skipped.push(`whatships ${it.slug}: not found`); continue; }
      throw err;
    }
    scanned++;
    const pub = parsePublished(e.published);
    if (pub && pub < since.getTime() - 86400e3) break; // index is newest first
    const entryText = [e.title, e.description, e.product, e.company, e.tags.join(", ")].join("\n");
    const entryHits = match(entryText);
    const relevant =
      (!categories.size && !tagHints.length) ||
      categories.has((e.category || "").toLowerCase()) ||
      tagHints.some((h) => e.tags.join(" ").toLowerCase().includes(h)) ||
      entryHits.length > 0;
    if (!relevant || !e.x_url) continue;
    let s;
    try {
      s = await xStats(e.x_url);
    } catch (err) {
      if (notFound(err)) { skipped.push(`fxtwitter ${e.x_url}: not found`); continue; }
      throw err;
    }
    enriched++;
    await sleep(400);
    if (!s || Date.parse(s.posted_at) < since.getTime() || ignored(s.author)) continue;
    const hits = [...new Set([...entryHits, ...match(s.text)])];
    const r = ratios(s, now);
    const stats = { ...s, ...r };
    const passes = thresholds.some(([k, n]) => stats[k] >= n);
    if (passes || hits.length) out.push(candidate(s, e, "whatships", now, hits));
  }

  for (const url of leads) {
    let s;
    try {
      s = await xStats(url);
    } catch (err) {
      if (notFound(err)) { skipped.push(`fxtwitter ${url}: not found`); continue; }
      throw err;
    }
    enriched++;
    await sleep(400);
    if (s && !ignored(s.author)) out.push(candidate(s, null, "lead", now, match(s.text)));
  }

  const items = finalize(out);
  await emit(items, opts.out);
  const skip = skipped.length ? `; skipped ${skipped.length} missing (${skipped.join("; ")})` : "";
  process.stderr.write(
    `${items.length} videos from ${scanned} What Ships entries and ${leads.length} leads (${enriched} enriched via fxtwitter)${skip}\n`,
  );
});
