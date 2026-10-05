# Radar

Go-to-market, with an agent that does the watching. Radar finds the conversations worth your reply across X, LinkedIn, Reddit, Hacker News and video, tells you why each one matters, and drafts replies in your voice. It never posts anything itself: you do, from the drafts.

- **Left, Scout.** One long-running conversation with Claude Code or Codex. Scout sets up what to watch with you, runs and improves the loops, answers "what deserves a reply today?", and drafts replies. Each message carries the post you are looking at.
- **Middle, the inbox.** Mail-like: posts grouped by *Reply now* and *Later*, each with who wrote it, why Scout kept it, and a draft when you want one. Mark it Replied, Save or Dismiss (`r`, `s`, `e`; `↑↓` to move; `d` asks for a draft). A Briefing tab holds one page per morning.
- **Right, the loops.** Each loop is a runbook on a schedule: Reddit, Hacker News, video trends, a morning briefing, and X and LinkedIn for machines with a signed-in browser. Each shows its last run and its next one, with Run now and an on/off switch. Scout supervises them: when a run ends, Scout hears about it and tells you what's worth your time.

## Install it on a Cube

Radar is a [Cube app](https://github.com/collabs-inc/cube-computer/blob/apps/docs/apps.md). Add `https://github.com/collabs-inc/cube-radar` in the Apps surface, or install it from the Market. It has no dependencies beyond Node 20, so the install takes seconds and creates `~/Radar`. Open it and Scout asks what to watch.

| What | Where |
|---|---|
| What to watch, your loops, your briefings | `~/Radar` (a git repository: `radar.json`, `loops/`, `briefings/`) |
| The inbox, loop runs, Scout's conversation | `~/.local/state/cube-radar` |

Nothing about *what* you watch ships with the app. Your topics, terms, competitors and subreddits live in your own `radar.json`. Point Radar at another folder (a private repository with your team's loops, say) with `RADAR_HOME`, or `"home"` in the state folder's `settings.json`. Scout and the loops run with every permission granted on the machine, as Cube's personas do.

## Loops

A loop is a Markdown runbook in `~/Radar/loops/` with a small front matter:

```markdown
---
name: Reddit
source: reddit
schedule: 30 7,13,18 * * *      # cron, in radar.json's timezone
enabled: true
---
What one run does, step by step.
```

Radar runs each due loop as its own short agent session, one at a time, briefed with `scout/LOOP.md`:

1. Fetch since the last run.
2. Skip what the inbox already has.
3. Triage against your `topics`.
4. Add what's worth a reply.
5. Report.

A loop never changes what you decided about a post. Ask Scout to add a loop ("watch Product Hunt launches") or to change one, or edit the file yourself; Radar picks up the change straight away.

The fetchers in `tools/` (`reddit.mjs`, `hn.mjs`, `video.mjs`) need no login and no dependencies; `tools/README.md` documents them and `radar.json`. X and LinkedIn show search only to a signed-in account, so those loops stay off until `radar.json` lists `"browser"` in `capabilities`.

## How a Cube app is put together

Radar follows the same template as [Cube Studio](https://github.com/collabs-inc/cube-studio):

- **`cube.json`** names the app and says how to install and start it.
- **The install** (`server/setup-home.mjs`) creates the user's folder once and never touches it again.
- **The server** listens on `$PORT` on `127.0.0.1`. Cube's gate signs the user in.
- **`kit/`** is shared with the Studio, unchanged:
  - `persona.mjs` and `persona.js`: the agent column (Claude Code or Codex, streamed turns, events while it's busy, one-off background work);
  - `ui.css`: the look (system type, Apple's grays and one accent, light and dark).

## Layout

```
cube.json            the Cube app contract
server/              server.mjs (API, scheduler, Scout), loops.mjs (runbooks, cron), store.mjs (the inbox), setup-home.mjs
web/                 the page
kit/                 the persona column and the look, shared with Cube Studio
scout/               SCOUT.md (Scout's brief), LOOP.md (a loop run's brief)
tools/               the fetchers
starter/             what ~/Radar starts with: radar.json and the loops
```

## Run it outside Cube

```bash
node server/setup-home.mjs && node server/server.mjs    # http://127.0.0.1:4321 ; RADAR_HOME, RADAR_STATE, PORT override
npm test
```

The server binds to `127.0.0.1` only. Outside Cube nothing signs a visitor in, so don't expose it.
