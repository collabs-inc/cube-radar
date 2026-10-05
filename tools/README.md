# Source fetchers

Three dependency-free fetchers (Node >= 20, ESM, built-in `fetch`, no npm packages). Each lists what was posted since a time, keeps what matches your `radar.json`, and prints candidates for an agent to triage.

```bash
node tools/reddit.mjs --since 24h
node tools/hn.mjs     --since 2026-10-01T08:00:00Z --out hn.json
node tools/video.mjs  --since 3d --config ./radar.json https://x.com/someone/status/123   # extra lead URLs
node --test tools/lib.test.mjs
```

- `--since` is an ISO time (an offset-less time is UTC) or a window: `30m`, `24h`, `7d`, `2w`.
- `--config` defaults to `$RADAR_HOME/radar.json`, else `~/Scout/radar.json`.
- `--out` writes the JSON array to a file; otherwise it goes to stdout. A one-line summary goes to stderr.
- Every request has a 60 s timeout and is retried with backoff on network errors, timeouts, 429 and 5xx. If a source still fails, the fetcher exits non-zero and writes nothing, so a caller never advances its last-run time past posts it never saw.

| Fetcher | Source | What it does |
|---|---|---|
| `reddit.mjs` | [Arctic Shift](https://arctic-shift.photon-reddit.com) public archive (trails Reddit by minutes, no login) | Lists every new post in each `reddit.subreddits` entry and matches title + body locally. Skips removed/deleted, NSFW, AutoModerator and `ignore_authors`. |
| `hn.mjs` | [Algolia HN API](https://hn.algolia.com/api) | Queries each watch name, phrase and each term of the first `all_of` group (stories and comments), then re-checks every hit with the full matcher. Stories need `hn.min_points`. Refuses (exits non-zero) if a term returns more than 3000 hits in the window. |
| `video.mjs` | [What Ships](https://whatships.com) curated launch videos + [fxtwitter](https://api.fxtwitter.com) public counts | Walks the newest 150 entries, enriches each X post with views, likes, reposts, bookmarks and follower count, and keeps those over any threshold or with a matcher hit. Lead URLs passed as arguments are always kept. Entries or posts that no longer exist (404) are skipped and named in the summary. |

## Output

An array, newest first, deduped by `id`:

```json
{
  "id": "hn:41234567",
  "source": "reddit | hn | video",
  "url": "https://news.ycombinator.com/item?id=41234567",
  "author": "someone",
  "author_url": "https://news.ycombinator.com/user?id=someone",
  "author_note": "HN comment",
  "title": "Comment on: Show HN: …",
  "text": "trimmed to 2000 characters",
  "posted_at": "2026-10-04T18:22:05Z",
  "metrics": { "points": 12, "num_comments": 4 },
  "matched": ["quick capture"]
}
```

`metrics` per source: Reddit `score, num_comments`; HN `points, num_comments` (comments also carry `story_id`); video `views, likes, reposts, replies, bookmarks, followers, video_seconds, age_hours, views_per_hour, views_per_follower` (reach past the poster's own audience) and `bookmark_rate` (bookmarks per 1k views). Video items also carry `details`: `via` (`whatships` or `lead`), and the directory's product, company, category, published date, duration, tags, page and poster image.

## radar.json

Everything about what you watch lives here; the fetchers contain no topics of their own. Example for a made-up note-taking app:

```json
{
  "topics": [
    "People looking for a fast, offline-first note-taking app",
    "Complaints about sync conflicts or slow search in note apps"
  ],
  "watch": {
    "names": ["Jotter", "jotter.app", "NoteRival"],
    "phrases": ["quick capture", "second brain"],
    "all_of": [["sync", "offline", "search"], ["notes", "notebook", "note-taking"]]
  },
  "ignore_authors": ["jotter_official"],
  "reddit": { "subreddits": ["productivity", "ObsidianMD", "selfhosted"] },
  "hn": { "min_points": 0 },
  "video": {
    "min_views": 250000,
    "min_views_per_follower": 20,
    "min_bookmark_rate": 5,
    "categories": ["Productivity"],
    "tag_hints": ["notes", "writing"]
  }
}
```

- `topics`: free text the triaging agent reads; the fetchers ignore it.
- `watch.names`: products and handles (competitors, your own) matched anywhere.
- `watch.phrases`: phrases matched anywhere.
- `watch.all_of`: groups of terms; a text matches only when every group has at least one term in it. Use it for generic words that only mean something together.
- Matching is case-insensitive and whole-word; whitespace in a term matches any run of whitespace; terms are literal (not regexes). `matched` lists the terms that hit.
- `ignore_authors`: usernames to drop on every source (case-insensitive, `@` optional).
- `video.categories` / `video.tag_hints`: optional What Ships pre-filter (category name, or a substring of a tag). With neither set, every entry is enriched. An entry whose text hits the matcher always passes. The `min_*` thresholds are alternatives: passing any one keeps the video.
