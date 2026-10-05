---
name: Reddit
source: reddit
schedule: 30 7,13,18 * * *
enabled: true
---
# Reddit

Every new post in the subreddits listed under `reddit.subreddits` in `radar.json`, matched against `watch`, then triaged against `topics`.

1. `node $RADAR_APP/tools/reddit.mjs --since <cursor minus 15 minutes> --out ~/.cache/cube-scout/reddit.json`. Posts come from Arctic Shift, a public archive that trails Reddit by a few minutes, because Reddit blocks most servers.
2. If `reddit.subreddits` is empty, report `{"error": "No subreddits in radar.json", "summary": "No subreddits to watch yet"}` and stop.
3. Skip known ids, triage, add and report as your brief says. `author_note` is the subreddit. A thread that is under 48 hours old and getting comments is `now`.
