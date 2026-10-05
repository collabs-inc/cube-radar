---
name: X
source: x
schedule: 0 7,13,18 * * *
requires: browser
enabled: false
---
# X

Live search on X for the `watch` terms in `radar.json`. X shows search only to a signed-in account and refuses most servers, so this loop needs a browser on this machine that is signed in to X. Add `"browser"` to `capabilities` in `radar.json` once there is one.

1. For each `watch` name and phrase, and the first `all_of` group, at most 10 searches per run: open `https://x.com/search?q=<urlencoded term>&f=live`, wait for results, scroll twice, and read the posts. Wait a few seconds between searches, because X limits accounts that look scripted.
2. Never like, reply, repost, follow or message.
3. Turn each post into an item: `id: "x:<status id>"`, `url`, `author` (the handle), `author_url`, `author_note` (display name and follower count when shown), `text`, `posted_at`, `metrics: { likes, reposts, replies, views }`.
4. Skip known ids, triage, add and report as your brief says.
