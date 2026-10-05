import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore, clean } from './store.mjs';

test('a loop adds items; your decisions survive the next run', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-store-'));
  const store = createStore(dir);
  const r1 = store.add([{ id: 'hn:1', text: 'first', priority: 'now', reason: 'asks for us' }], 'hacker-news');
  assert.deepEqual(r1.added, ['hn:1']);
  assert.equal(store.get('hn:1').status, 'new');
  assert.equal(store.get('hn:1').source, 'hn');
  store.update('hn:1', { status: 'dismissed', draft: 'thanks!' });
  const r2 = store.add([{ id: 'hn:1', text: 'changed', status: 'new', topic: 'a topic' }]);
  assert.deepEqual(r2.existed, ['hn:1']);
  const it = store.get('hn:1');
  assert.equal(it.status, 'dismissed');      // never reset by a loop
  assert.equal(it.text, 'first');            // fields it had stay
  assert.equal(it.topic, 'a topic');         // fields it lacked are filled
  assert.equal(it.draft, 'thanks!');
});

test('items are cleaned: ids, links and sizes', () => {
  assert.throws(() => clean({ id: 'nope' }), /source/);
  const x = clean({ id: 'reddit:abc', url: 'javascript:alert(1)', author_url: 'https://reddit.com/u/x', text: 'a'.repeat(10000), metrics: { score: '12', bad: 'x' }, extra: 1 });
  assert.equal(x.url, undefined);
  assert.equal(x.author_url, 'https://reddit.com/u/x');
  assert.equal(x.text.length, 6000);
  assert.deepEqual(x.metrics, { score: 12 });
  assert.equal(x.extra, undefined);
});
