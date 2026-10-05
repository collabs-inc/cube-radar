---
name: Video trends
source: video
schedule: 45 7 * * *
enabled: true
---
# Video trends

Launch and demo videos on X that are doing unusually well in the user's space, so they can ride a format or a conversation. The source is What Ships (a curated directory of launch videos) with public counts from fxtwitter, and neither needs a login.

1. `node $RADAR_APP/tools/video.mjs --since <cursor minus 15 minutes, or 48 hours on a first run> --out ~/.cache/cube-scout/video.json`. Thresholds come from `video` in `radar.json`.
2. Keep a video only if it is in or next to the user's space (see `topics`) and it teaches something: a format, a hook, an angle. For each one kept:
   - `category`: `trend`.
   - `reason`: what the format is and why it works (the hook in the first 2 seconds, the length, the payoff).
   - `note`: the piece the user could make in the same spirit, in one sentence.
   - `priority`: `now` when it is a live conversation this week, else `later`.
3. Skip known ids, add and report as your brief says.
