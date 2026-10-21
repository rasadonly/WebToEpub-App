import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backendToc } from './backend.ts';

globalThis.window = { setTimeout, clearTimeout };
globalThis.localStorage = { getItem: () => null };
const chapter = { url: 'https://novgo.net/test/chapter-1.html', title: 'Chapter 1' };
const stream = () => new Response([
  JSON.stringify({ type: 'chapters', items: [chapter] }),
  JSON.stringify({ type: 'meta', title: 'Test book' }),
  JSON.stringify({ type: 'done' }),
  '',
].join('\n'));

test('NovGo metadata and chapter loading share one request and replay chapters once', async () => {
  let requests = 0;
  globalThis.fetch = async () => { requests++; return stream(); };
  const url = 'https://novgo.net/shared-test.html';
  const [first, second] = await Promise.all([backendToc(url), backendToc(url)]);
  const batches = [];
  await backendToc(url, '', items => batches.push(items));
  assert.equal(requests, 1);
  assert.deepEqual(first, second);
  assert.deepEqual(batches, [[chapter]]);
});

test('explicit streaming errors reach the buffered fallback', async () => {
  const requests = [];
  globalThis.fetch = async url => {
    requests.push(url);
    if (url.includes('/stream?')) return new Response('{"type":"error","message":"Unavailable"}\n');
    return new Response(JSON.stringify({ chapters: [chapter], meta: {} }), { headers: { 'content-type': 'application/json' } });
  };
  const result = await backendToc('https://novgo.net/fallback-test.html');
  assert.equal(requests.length, 2);
  assert.deepEqual(result.chapters, [chapter]);
});