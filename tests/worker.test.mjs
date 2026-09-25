// Unit test for worker/src/index.js in plain Node: fake Durable Object storage, mocked Gemini API.
// Usage: node tests/worker.test.mjs

import assert from 'node:assert/strict';
import worker, { Quota } from '../worker/src/index.js';

// ---- Fake Durable Object namespace backed by a Map ----
function fakeNamespace() {
  const map = new Map();
  const storage = {
    async get(k) { return map.get(k); },
    async put(obj) { for (const [k, v] of Object.entries(obj)) map.set(k, v); },
    async delete(keys) { for (const k of [].concat(keys)) map.delete(k); },
    async list() { return new Map(map); },
  };
  const instance = new Quota({ storage });
  return {
    map,
    idFromName: () => 'global',
    get: () => ({ fetch: (url, init) => instance.fetch(new Request(url, init)) }),
  };
}

// ---- Mocked Gemini ----
const calls = [];
let geminiMode = 'ok';
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return realFetch(url, init);
  const body = JSON.parse(init.body);
  calls.push({ url: String(url), headers: init.headers, body });
  if (geminiMode === 'busy' && String(url).includes('gemini-flash-latest')) {
    return Response.json({ error: { code: 429, message: 'Resource exhausted' } }, { status: 429 });
  }
  if (geminiMode === 'down') return Response.json({ error: { message: 'boom' } }, { status: 500 });
  const out = {
    title: 'لوگوی کافه',
    detected_language: 'fa',
    prompt_en: 'Role: senior brand designer. Task: minimalist cafe logo.',
    prompt_fa: 'نقش: طراح ارشد برند. وظیفه: لوگوی مینیمال کافه.',
    notes: ['نقش مشخص شد'],
  };
  return Response.json({
    candidates: [{ content: { parts: [{ text: 'thinking...', thought: true }, { text: '```json\n' + JSON.stringify(out) + '\n```' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 700, candidatesTokenCount: 300 },
    modelVersion: String(url).includes('lite') ? 'gemini-flash-lite' : 'gemini-flash',
  });
};

const ORIGIN = 'https://mrasoul10-sudo.github.io';
const env = {
  GEMINI_API_KEY: 'test-key',
  ALLOWED_ORIGINS: `${ORIGIN},http://localhost:8765`,
  GEMINI_MODEL: 'gemini-flash-latest',
  GEMINI_FALLBACK_MODEL: 'gemini-flash-lite-latest',
  DAILY_LIMIT_PER_VISITOR: '3',
  DAILY_LIMIT_GLOBAL: '100',
  PER_MINUTE_LIMIT_GLOBAL: '50',
  QUOTA: fakeNamespace(),
};

const req = (path, { method = 'POST', body, origin = ORIGIN, ip = '1.2.3.4' } = {}) => new Request(`https://api.test${path}`, {
  method,
  headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}), 'cf-connecting-ip': ip },
  body: body ? JSON.stringify(body) : undefined,
});
const call = async (...args) => {
  const res = await worker.fetch(req(...args), env);
  return { res, body: res.status === 204 ? null : await res.json() };
};

// Preflight and origin checks
{
  const { res } = await call('/generate', { method: 'OPTIONS' });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
  const bad = await call('/generate', { origin: 'https://evil.example', body: { source: 'x' } });
  assert.equal(bad.res.status, 403);
}

// Successful generation: request shape, parsing, remaining quota
{
  const { res, body } = await call('/generate', { body: { source: 'یک لوگو برای کافه', type: 'image', lang: 'both', detail: 'bogus' } });
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.result.title, 'لوگوی کافه');
  assert.ok(body.result.promptEn && body.result.promptFa);
  assert.equal(body.remaining, 2);
  const c = calls.at(-1);
  assert.match(c.url, /gemini-flash-latest:generateContent$/);
  assert.equal(c.headers['x-goog-api-key'], 'test-key');
  assert.equal(c.body.generationConfig.responseMimeType, 'application/json');
  assert.equal(c.body.generationConfig.responseSchema.type, 'OBJECT');
  assert.equal(c.body.generationConfig.responseSchema.properties.notes.items.type, 'STRING');
  assert.ok(!('additionalProperties' in c.body.generationConfig.responseSchema));
  assert.match(c.body.contents[0].parts[0].text, /Prompt type: image/);
  assert.match(c.body.contents[0].parts[0].text, /Detail level: balanced/, 'invalid options are normalized');
  assert.match(c.body.systemInstruction.parts[0].text, /Prompt Creator/);
}

// Language filter
{
  const { body } = await call('/generate', { body: { source: 'hello', lang: 'en' } });
  assert.equal(body.result.promptFa, '');
}

// Busy primary model falls back to the lite model
{
  geminiMode = 'busy';
  const { res, body } = await call('/generate', { body: { source: 'x' } });
  assert.equal(res.status, 200);
  assert.equal(body.model, 'gemini-flash-lite');
  assert.equal(body.remaining, 0);
  geminiMode = 'ok';
}

// Per-visitor daily limit; another visitor still has quota; /quota reports it
{
  const { res, body } = await call('/generate', { body: { source: 'x' } });
  assert.equal(res.status, 429);
  assert.equal(body.error, 'quota');
  const other = await call('/quota', { method: 'GET', ip: '5.6.7.8' });
  assert.equal(other.body.remaining, 3);
}

// Upstream failure refunds the quota
{
  geminiMode = 'down';
  const before = (await call('/quota', { method: 'GET', ip: '9.9.9.9' })).body.remaining;
  const { res, body } = await call('/generate', { ip: '9.9.9.9', body: { source: 'x' } });
  assert.equal(res.status, 502);
  assert.equal(body.error, 'upstream_error');
  const after = (await call('/quota', { method: 'GET', ip: '9.9.9.9' })).body.remaining;
  assert.equal(after, before, 'failed call does not use quota');
  geminiMode = 'ok';
}

// Validation
{
  assert.equal((await call('/generate', { body: { source: '   ' } })).res.status, 400);
  assert.equal((await call('/generate', { ip: '7.7.7.7', body: { source: 'x'.repeat(20001) } })).res.status, 413);
  assert.equal((await call('/nope', { method: 'GET' })).res.status, 404);
}

// Raw IPs are never stored
assert.ok([...env.QUOTA.map.keys()].every((k) => !k.includes('1.2.3.4')));

console.log('worker tests passed');
