---
name: Morning briefing
schedule: 0 8 * * *
enabled: true
---
# Morning briefing

One page the user reads with their coffee: what came in since yesterday's briefing, what deserves a reply today, and whether every loop is healthy.

1. `curl -s $RADAR_URL/api/items` and `curl -s $RADAR_URL/api/loops`. Take the items found since your cursor (on a first run, the last 24 hours).
2. Write `briefings/<YYYY-MM-DD>.md` (today, in `radar.json`'s time zone), titled `# <Weekday> <Month> <day>`:
   - **Reply today:** each `now` item still `new`, as `- [<author> on <source>](<url>): <one line on why>`. Mention when a draft is waiting.
   - **Worth a look:** the best `later` items, at most 8.
   - **Trends:** video trends worth riding, if any.
   - **Loops:** one line per loop with its last run's summary; flag any that failed or haven't run in over a day.
   - Keep it under a page. If nothing came in, say so in one line.
3. Commit the file (`git add briefings && git commit -m "Briefing <date>"`).
4. Report `{"summary": "<n> to reply today, <m> worth a look", "cursor": "<now, ISO>"}`.
