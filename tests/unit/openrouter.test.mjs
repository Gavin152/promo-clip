import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { client, withFallback, loadKey, isPolicyBlock, ProviderError } from '../../engine/tools/providers/openrouter.mjs';

const res = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  json: async () => body,
  arrayBuffer: async () => Buffer.from('PCM').buffer,
});
function fakeFetch(replies) {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, body: init?.body ? JSON.parse(init.body) : null, headers: init?.headers }); const r = replies.shift(); if (r instanceof Error) throw r; return r; };
  f.calls = calls;
  return f;
}

test('key: env var wins, else nearest .env walking up', () => {
  const root = mkdtempSync(join(tmpdir(), 'or-key-'));
  mkdirSync(join(root, 'a/b'), { recursive: true });
  writeFileSync(join(root, '.env'), 'OTHER=1\nOPENROUTER_API_KEY="sk-parent"\n');
  const saved = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    assert.equal(loadKey(join(root, 'a/b')), 'sk-parent');
    writeFileSync(join(root, 'a/.env'), 'OPENROUTER_API_KEY=sk-near');
    assert.equal(loadKey(join(root, 'a/b')), 'sk-near');
    process.env.OPENROUTER_API_KEY = 'sk-env';
    assert.equal(loadKey(join(root, 'a/b')), 'sk-env');
  } finally {
    if (saved === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = saved;
  }
});

test('retries 429/5xx/network errors with backoff, then succeeds', async () => {
  const f = fakeFetch([res(429, 'slow down'), new Error('ECONNRESET'), res(200, { choices: [], usage: { cost: 0.01 } })]);
  const c = client({ key: 'k', fetchImpl: f, delays: [1, 1, 1] });
  const r = await c.chat({ model: 'm', messages: [] });
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[0].body.usage.include, true);
  assert.equal(await c.actualCost(r), 0.01);
});

test('gives up after the retries with the last error', async () => {
  const f = fakeFetch([res(500, 'a'), res(502, 'b'), res(503, 'c'), res(503, 'd')]);
  const c = client({ key: 'k', fetchImpl: f, delays: [1, 1, 1] });
  await assert.rejects(c.chat({ model: 'm' }), /503/);
  assert.equal(f.calls.length, 4);
});

test('client errors are not retried; policy blocks are flagged', async () => {
  const f = fakeFetch([res(400, 'bad request')]);
  await assert.rejects(client({ key: 'k', fetchImpl: f, delays: [1] }).chat({ model: 'm' }), (e) => e instanceof ProviderError && !e.policy && e.status === 400);
  assert.equal(f.calls.length, 1);
  const g = fakeFetch([res(404, 'No endpoints found matching your data policy (Zero data retention)')]);
  await assert.rejects(client({ key: 'k', fetchImpl: g, delays: [1] }).chat({ model: 'm' }), (e) => e.policy === true);
  assert.ok(isPolicyBlock(403, 'blocked by ZDR'));
  assert.ok(!isPolicyBlock(500, 'zdr'));
});

test('withFallback skips policy-blocked models, stops on other errors', async () => {
  const blocked = new ProviderError('zdr', { policy: true });
  const r = await withFallback(['a', 'b', 'c'], async (m) => { if (m === 'a') throw blocked; return `ok:${m}`; }, { log: () => {} });
  assert.equal(r.model, 'b');
  assert.equal(r.result, 'ok:b');
  assert.equal(r.skipped.length, 1);
  await assert.rejects(withFallback(['a', 'b'], async () => { throw new Error('boom'); }, { log: () => {} }), /boom/);
  await assert.rejects(withFallback(['a', 'b'], async () => { throw blocked; }, { log: () => {} }), /every model was blocked/);
});

test('tts returns audio + generation id; actualCost falls back to generation stats', async () => {
  const f = fakeFetch([res(200, null, { 'x-generation-id': 'gen-1' }), res(200, { data: { total_cost: 0.012 } })]);
  const c = client({ key: 'k', fetchImpl: f, delays: [1] });
  const r = await c.tts({ model: 'm', voice: 'v', input: 'hi' });
  assert.equal(r.id, 'gen-1');
  assert.equal(f.calls[0].body.response_format, 'pcm');
  assert.equal(await c.actualCost(r), 0.012);
  assert.match(f.calls[1].url, /generation\?id=gen-1/);
});
