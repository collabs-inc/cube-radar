// Creates the user's Radar folder the first time the app is installed: ~/Radar (or RADAR_HOME), a git repository
// with the starter loops and an empty radar.json, so Scout has somewhere to write what to watch. An existing folder
// is never changed, except for the managed block in its AGENTS.md that names where this app lives.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { APP, STATE, home } from './paths.mjs';

const HOME = home();
const BEGIN = '<!-- cube-radar:begin -->', END = '<!-- cube-radar:end -->';
const block = `${BEGIN}
## The Radar app

This folder belongs to Radar, a Cube app. Its code lives at \`${APP}\`; never edit it there, because an update
replaces that folder.

- \`radar.json\`: what to watch. The format is in \`${APP}/tools/README.md\`.
- \`loops/\`: one runbook per loop, with its schedule in the front matter. A loop run follows \`${APP}/scout/LOOP.md\`.
- \`briefings/\`: one Markdown file per day.
- Radar's API, for adding to and reading the inbox: \`$RADAR_URL\` (see \`${APP}/scout/SCOUT.md\`).
${END}`;

const AGENTS = `# Radar

Go-to-market: the conversations worth being in, found by loops and triaged by Scout. Add anything about your
product, your audience or how you like to reply here; Scout reads this file first.

${block}
`;

const git = (...a) => execFileSync('git', ['-C', HOME, ...a], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
fs.mkdirSync(STATE, { recursive: true });

if (!fs.existsSync(HOME)) {
  fs.mkdirSync(HOME, { recursive: true });
  fs.cpSync(path.join(APP, 'starter'), HOME, { recursive: true });
  fs.mkdirSync(path.join(HOME, 'briefings'), { recursive: true });
  fs.writeFileSync(path.join(HOME, 'briefings', '.gitkeep'), '');
  fs.writeFileSync(path.join(HOME, 'AGENTS.md'), AGENTS);
  fs.writeFileSync(path.join(HOME, 'CLAUDE.md'), '@AGENTS.md\n');
  fs.writeFileSync(path.join(HOME, '.gitignore'), '.DS_Store\n');
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  let who = [];
  try { git('config', 'user.email'); } catch { who = ['-c', 'user.name=Radar', '-c', 'user.email=radar@cube.invalid']; }
  execFileSync('git', ['-C', HOME, ...who, 'commit', '-q', '-m', 'Start Radar'], { stdio: 'ignore' });
  console.log(`radar: created ${HOME}`);
} else {
  const f = path.join(HOME, 'AGENTS.md');
  let text = '';
  try { text = fs.readFileSync(f, 'utf8'); } catch {}
  const i = text.indexOf(BEGIN), j = text.indexOf(END);
  if (i >= 0 && j > i) {
    const next = text.slice(0, i) + block + text.slice(j + END.length);
    if (next !== text) { fs.writeFileSync(f, next); console.log(`radar: updated the app's paths in ${f}`); }
  }
  console.log(`radar: ${HOME} already exists; left as it is`);
}
