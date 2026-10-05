// Where things live. Radar is an app: its own folder (APP) holds the code and is replaced by every update, so
// nothing the user makes or configures is ever written there.
//
//   APP      this repository: server/, web/, kit/, tools/, scout/, starter/
//   HOME     the user's Radar folder, a git repository: radar.json (what to watch), loops/ (the runbooks),
//            briefings/. ~/Radar by default, created at install; RADAR_HOME, or "home" in STATE/settings.json,
//            points it elsewhere (a private repository with your own loops, for example).
//   STATE    Radar's bookkeeping: the inbox, loop runs, Scout's conversation.
//            ~/.local/state/cube-radar (RADAR_STATE, or $XDG_STATE_HOME/cube-radar)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const STATE = path.resolve(process.env.RADAR_STATE
  || path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'cube-radar'));

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
export const settings = () => readJson(path.join(STATE, 'settings.json'), {});
export function saveSettings(patch) {
  fs.mkdirSync(STATE, { recursive: true });
  const next = { ...settings(), ...patch };
  fs.writeFileSync(path.join(STATE, 'settings.json'), JSON.stringify(next, null, 2));
  return next;
}
const expand = p => path.resolve(String(p).replace(/^~(?=$|\/)/, os.homedir()));
export const home = () => expand(process.env.RADAR_HOME || settings().home || path.join(os.homedir(), 'Radar'));
