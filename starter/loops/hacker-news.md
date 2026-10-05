---
name: Hacker News
source: hn
schedule: 0 8,14,19 * * *
enabled: true
---
# Hacker News

Stories and comments on Hacker News that match `watch`, through the Algolia HN search API.

1. `node $RADAR_APP/tools/hn.mjs --since <cursor minus 15 minutes> --out ~/.cache/cube-scout/hn.json`.
2. Comments arrive titled "Comment on: <story>". A comment that asks for what the user makes, inside a thread that is still on the front page, is `now`.
3. Skip known ids, triage, add and report as your brief says.
