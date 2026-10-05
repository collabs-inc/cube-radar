---
name: LinkedIn
source: linkedin
schedule: 0 7,13,18 * * *
requires: browser
enabled: false
---
# LinkedIn

Recent LinkedIn posts that match the `watch` terms in `radar.json`. LinkedIn shows content search only to a signed-in member, so this loop needs a browser on this machine that is signed in to LinkedIn. Add `"browser"` to `capabilities` in `radar.json` once there is one.

1. At most 9 searches per run, a few seconds apart, because LinkedIn restricts accounts that look scripted. Open `https://www.linkedin.com/search/results/content/?keywords=<urlencoded term>&sortBy=%22date_posted%22&datePosted=%22past-24h%22`, then scroll the results with real wheel scrolling (only that loads more than the first few). Keep searches flat: nested `(A OR B) AND C` queries return nothing.
2. If LinkedIn shows its sign-in page, stop and report `{"error": "LinkedIn is signed out"}`. Never type credentials.
3. Never like, comment, connect or message.
4. Turn each post into an item: `id: "linkedin:<numeric activity id>"`, `url`, `author`, `author_url`, `author_note` (their headline), `text`, `posted_at`.
5. Skip known ids, triage, add and report as your brief says.
