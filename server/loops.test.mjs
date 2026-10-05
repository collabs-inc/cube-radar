import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCron, nextRun, describeCron, parseRunbook } from './loops.mjs';

const at = (iso) => Date.parse(iso);

test('next run is in the loop’s own time zone, across a DST change', () => {
  // 06:30 in Los Angeles is 13:30 UTC in summer time and 14:30 UTC after the switch on Nov 1
  assert.equal(new Date(nextRun('30 6 * * *', 'America/Los_Angeles', at('2026-10-05T00:00:00Z'))).toISOString(), '2026-10-05T13:30:00.000Z');
  assert.equal(new Date(nextRun('30 6 * * *', 'America/Los_Angeles', at('2026-11-01T20:00:00Z'))).toISOString(), '2026-11-02T14:30:00.000Z');
});

test('lists, ranges, steps and weekdays', () => {
  const from = at('2026-10-05T10:07:00Z');   // a Monday
  assert.equal(new Date(nextRun('*/15 * * * *', 'UTC', from)).toISOString(), '2026-10-05T10:15:00.000Z');
  assert.equal(new Date(nextRun('0 9 * * 6', 'UTC', from)).toISOString(), '2026-10-10T09:00:00.000Z');
  assert.equal(new Date(nextRun('0 8,20 * * mon-fri', 'UTC', from)).toISOString(), '2026-10-05T20:00:00.000Z');
  assert.equal(nextRun('0 0 31 2 *', 'UTC', from), null);     // never within 8 days
});

test('a bad schedule says why', () => {
  assert.throws(() => parseCron('* * *'), /five fields/);
  assert.throws(() => parseCron('61 * * * *'), /bad cron field/);
});

test('schedules read like a person wrote them', () => {
  assert.equal(describeCron('30 6,12,17 * * *'), 'Daily at 6:30, 12:30 and 17:30');
  assert.equal(describeCron('0 9 * * 1-5'), 'Weekdays at 9:00');
  assert.equal(describeCron('0 */2 * * *'), 'Every 2 hours');
  assert.equal(describeCron('0 8 * * mon'), 'Mondays at 8:00');
});

test('front matter: scalars, booleans, inline and block lists, comments', () => {
  const { meta, body } = parseRunbook('---\nname: Reddit\nschedule: 30 6 * * *   # morning\nenabled: false\nrequires: [browser, notion]\ntags:\n  - a\n  - b\n---\n# Body\n');
  assert.deepEqual(meta, { name: 'Reddit', schedule: '30 6 * * *', enabled: false, requires: ['browser', 'notion'], tags: ['a', 'b'] });
  assert.equal(body, '# Body\n');
});
