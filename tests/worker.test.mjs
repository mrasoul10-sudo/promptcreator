// Unit test for worker/src/index.js in plain Node: fake Durable Object storage, mocked Gemini API.
// Usage: node tests/worker.test.mjs

import assert from 'node:assert/strict';
import worker, { Quota, Store } from '../worker/src/index.js';
import { fakeSqlNamespace, GOOGLE_JWKS, googleIdToken } from './fake-cloudflare.mjs';
import { formatPrompt } from '../assets/js/prompt-spec.js';

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
  if (String(url) === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json(GOOGLE_JWKS, { headers: { 'cache-control': 'max-age=3600' } });
  if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return realFetch(url, init);
  const body = JSON.parse(init.body);
  calls.push({ url: String(url), headers: init.headers, body });
  if (geminiMode === 'busy' && String(url).includes('gemini-flash-latest')) {
    return Response.json({ error: { code: 429, message: 'Resource exhausted' } }, { status: 429 });
  }
  if (geminiMode === 'down') return Response.json({ error: { message: 'boom' } }, { status: 500 });
  if (body.contents[0].parts[0].inlineData) {
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ text: 'یک لوگو برای کافه می‌خواهم.', language: 'fa' }) }] }, finishReason: 'STOP' }], modelVersion: 'gemini-flash' });
  }
  if (geminiMode === 'echo' && !body.contents[0].parts[0].text.includes('repeated the input')) {
    const src = body.contents[0].parts[0].text.split('<input>\n')[1].split('\n</input>')[0];
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ title: 't', detected_language: 'fa', prompt_en: '', prompt_fa: src, notes: [] }) }] }, finishReason: 'STOP' }] });
  }
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
  GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
  ADMIN_EMAIL: 'boss@example.com',
};
env.STORE = fakeSqlNamespace(Store, env);

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
  assert.equal(body.detail, 'boom', 'upstream error text is exposed for diagnosis');
  const after = (await call('/quota', { method: 'GET', ip: '9.9.9.9' })).body.remaining;
  assert.equal(after, before, 'failed call does not use quota');
  geminiMode = 'ok';
}

// Echo detection: a copy of the input triggers one retry with the stronger instruction
{
  geminiMode = 'echo';
  const before = calls.length;
  const src = 'مانده برنامه کل برنامه اینها به عدد نوشتن کار خوبی نیست چرا نباید مثلا تعداد باربیکیو اروپایی را با نظم دهنده جمع بست';
  const { res, body } = await call('/generate', { ip: '8.8.8.8', body: { source: src } });
  assert.equal(res.status, 200);
  assert.equal(calls.length - before, 2, 'echo triggers exactly one retry');
  assert.match(calls.at(-1).body.contents[0].parts[0].text, /repeated the input/);
  assert.notEqual(body.result.promptFa, src);
  geminiMode = 'ok';
}

// Inappropriate language is refused without calling Gemini or using quota
{
  const before = calls.length;
  const { res, body } = await call('/generate', { ip: '6.6.6.6', body: { source: 'یک متن با کلمه کیییر برای تست' } });
  assert.equal(res.status, 422);
  assert.equal(body.error, 'inappropriate');
  assert.equal(calls.length, before, 'no model call');
  assert.equal((await call('/quota', { method: 'GET', ip: '6.6.6.6' })).body.remaining, 3, 'no quota used');
}

// Validation
{
  assert.equal((await call('/generate', { body: { source: '   ' } })).res.status, 400);
  assert.equal((await call('/generate', { ip: '7.7.7.7', body: { source: 'x'.repeat(20001) } })).res.status, 413);
  assert.equal((await call('/nope', { method: 'GET' })).res.status, 404);
}

// Raw IPs are never stored
assert.ok([...env.QUOTA.map.keys()].every((k) => !k.includes('1.2.3.4')));

// Voice input: POST /transcribe takes a WAV recording, returns clean text, and uses its own daily counter
{
  const wav = new Uint8Array(4000);
  wav.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
  wav.set([...'WAVE'].map((c) => c.charCodeAt(0)), 8);
  const send = (bytes, type = 'audio/wav', ip = '9.9.9.9') => worker.fetch(new Request('https://api.test/transcribe', {
    method: 'POST', headers: { 'content-type': type, origin: ORIGIN, 'cf-connecting-ip': ip }, body: bytes,
  }), env);
  geminiMode = 'ok';
  const before = calls.length;
  let res = await send(wav);
  let body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.text, 'یک لوگو برای کافه می‌خواهم.');
  assert.equal(body.language, 'fa');
  const sent = calls.at(-1).body;
  assert.equal(sent.contents[0].parts[0].inlineData.mimeType, 'audio/wav');
  assert.equal(sent.contents[0].parts[0].inlineData.data, Buffer.from(wav).toString('base64'), 'audio forwarded as base64');
  assert.ok(sent.systemInstruction.parts[0].text.includes('Never translate'), 'fixed server-side transcription prompt');
  assert.equal(calls.length, before + 1);
  // Not WAV, wrong type, or too large: refused without calling Gemini
  assert.equal((await send(new Uint8Array(4000))).status, 400);
  assert.equal((await send(wav, 'application/json')).status, 415);
  assert.equal((await send(new Uint8Array(3_000_001).fill(1))).status, 413);
  assert.equal(calls.length, before + 1);
  // Voice has its own per-visitor limit; prompt quota is untouched
  env.DAILY_VOICE_LIMIT_PER_VISITOR = '2';
  assert.equal((await send(wav)).status, 200);
  res = await send(wav);
  body = await res.json();
  assert.equal(res.status, 429);
  assert.equal(body.error, 'quota');
  const q = await worker.fetch(new Request('https://api.test/quota', { headers: { origin: ORIGIN, 'cf-connecting-ip': '9.9.9.9' } }), env);
  assert.equal((await q.json()).remaining, 3, 'voice does not use the prompt quota');
  // A failing model refunds the voice counter
  env.DAILY_VOICE_LIMIT_PER_VISITOR = '5';
  geminiMode = 'down';
  assert.equal((await send(wav, 'audio/wav', '8.8.8.8')).status, 502);
  geminiMode = 'ok';
  for (let i = 0; i < 5; i += 1) assert.equal((await send(wav, 'audio/wav', '8.8.8.8')).status, 200, 'refunded after failure');
}

// ---------- Accounts, sync, admin ----------
{
  const api = async (method, path, body, token, ip = '5.5.5.5') => {
    const res = await worker.fetch(new Request(`https://api.test${path}`, {
      method,
      headers: { 'content-type': 'application/json', origin: ORIGIN, 'cf-connecting-ip': ip, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }), env);
    return { status: res.status, body: await res.json(), cors: res.headers.get('access-control-allow-headers') };
  };
  const key = (c) => c.repeat(64);
  const salt = 'a'.repeat(32);

  // Register, lookup, login, wrong password
  let r = await api('POST', '/auth/lookup', { email: 'Sara@Example.com' });
  assert.deepEqual(r.body, { exists: false });
  assert.ok(r.cors.includes('authorization'), 'CORS allows the bearer header');
  r = await api('POST', '/auth/register', { name: 'سارا', email: 'Sara@Example.com', clientSalt: salt, key: key('1'), remember: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.token, /^[0-9a-f]{64}$/);
  assert.match(r.body.recoveryCode, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(r.body.user.email, 'sara@example.com');
  assert.equal(r.body.user.admin, false);
  const sara = r.body;
  assert.equal((await api('POST', '/auth/register', { name: 'x2', email: 'sara@example.com', clientSalt: salt, key: key('2') })).status, 409);
  r = await api('POST', '/auth/lookup', { email: 'sara@example.com' });
  assert.deepEqual(r.body, { exists: true, clientSalt: salt, hasPassword: true, google: false });
  assert.equal((await api('POST', '/auth/login', { email: 'sara@example.com', key: key('2') })).status, 401);
  r = await api('POST', '/auth/login', { email: 'sara@example.com', key: key('1') });
  assert.equal(r.status, 200);
  const sara2 = r.body.token;
  assert.equal((await api('GET', '/me', null, 'f'.repeat(64))).status, 401, 'unknown token refused');
  assert.equal((await api('GET', '/me', null, sara2)).body.user.name, 'سارا');

  // Sync: push, pull on another device, last write wins, tombstones
  r = await api('POST', '/sync', { since: 0, changes: [
    { id: 'p1', source: 'a', title: 'one', createdAt: 1, updatedAt: 100, archived: false },
    { id: 'p2', source: 'b', title: 'two', createdAt: 2, updatedAt: 100, archived: true, userId: 'local', dirty: true },
  ] }, sara.token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.changes.length, 2);
  assert.equal(r.body.changes[1].userId, undefined, 'local-only fields are not stored');
  const cursor1 = r.body.cursor;
  r = await api('POST', '/sync', { since: 0, changes: [] }, sara2);
  assert.deepEqual(r.body.changes.map((c) => c.id).sort(), ['p1', 'p2'], 'second device pulls everything');
  r = await api('POST', '/sync', { since: cursor1, changes: [{ id: 'p1', source: 'a', title: 'stale', updatedAt: 50 }] }, sara2);
  assert.equal(r.body.changes.length, 0, 'older write ignored');
  r = await api('POST', '/sync', { since: cursor1, changes: [{ id: 'p1', source: 'a', title: 'newer', updatedAt: 200 }, { id: 'p2', deleted: true, updatedAt: 300 }] }, sara2);
  assert.equal(r.body.changes.length, 2);
  r = await api('POST', '/sync', { since: cursor1, changes: [] }, sara.token);
  assert.equal(r.body.changes.find((c) => c.id === 'p1').title, 'newer');
  assert.deepEqual(r.body.changes.find((c) => c.id === 'p2'), { id: 'p2', deleted: true, updatedAt: 300 });
  assert.equal((await api('POST', '/sync', { since: 0, changes: [{ id: 'bad id!', updatedAt: 1 }] }, sara.token)).body.rejected[0], 'bad id!');
  assert.equal((await api('POST', '/sync', { since: 0, changes: [] })).status, 401, 'sync needs a session');

  // Recovery code resets the password
  assert.equal((await api('POST', '/auth/reset', { email: 'sara@example.com', code: 'WRONG-CODE-1234', key: key('3') })).status, 401);
  r = await api('POST', '/auth/reset', { email: 'sara@example.com', code: sara.recoveryCode.toLowerCase(), key: key('3') });
  assert.equal(r.status, 200);
  assert.notEqual(r.body.recoveryCode, sara.recoveryCode, 'a fresh code replaces the used one');
  assert.equal((await api('GET', '/me', null, sara.token)).status, 401, 'reset signs out other sessions');
  assert.equal((await api('POST', '/auth/login', { email: 'sara@example.com', key: key('3') })).status, 200);

  // Google: bad signature refused; first sign-in creates an account
  const forged = googleIdToken({ aud: env.GOOGLE_CLIENT_ID, sub: 'g1', email: 'boss@example.com' }).replace(/\.[^.]+$/, '.AAAA');
  assert.equal((await api('POST', '/auth/google', { credential: forged })).status, 401);
  assert.equal((await api('POST', '/auth/google', { credential: googleIdToken({ aud: 'other-client', sub: 'g1', email: 'boss@example.com' }) })).status, 401, 'wrong audience');

  // Pre-hijack guard + admin: someone registers the admin email with a password; the real owner then signs in with Google
  r = await api('POST', '/auth/register', { name: 'attacker', email: 'boss@example.com', clientSalt: salt, key: key('9') });
  const attacker = r.body.token;
  assert.equal(r.body.user.admin, false, 'an unverified password account is never admin');
  assert.equal((await api('GET', '/admin/stats', null, attacker)).status, 403);
  r = await api('POST', '/auth/google', { credential: googleIdToken({ aud: env.GOOGLE_CLIENT_ID, sub: 'g-boss', email: 'boss@example.com', name: 'Boss' }) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.passwordRemoved, true);
  assert.equal(r.body.user.admin, true, 'admin after Google proves the email');
  const boss = r.body.token;
  assert.equal((await api('GET', '/me', null, attacker)).status, 401, 'old sessions revoked');
  assert.equal((await api('POST', '/auth/login', { email: 'boss@example.com', key: key('9') })).status, 400, 'old password removed');

  // Admin panel
  r = await api('GET', '/admin/stats', null, boss);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.users.total, 2);
  assert.equal(r.body.prompts.total, 1, 'deleted prompts not counted');
  assert.ok(r.body.quota && typeof r.body.quota.usedToday === 'number');
  r = await api('GET', '/admin/users?q=sara', null, boss);
  assert.equal(r.body.users.length, 1);
  assert.equal(r.body.users[0].prompts, 1);
  const saraId = r.body.users[0].id;
  const saraNow = (await api('POST', '/auth/login', { email: 'sara@example.com', key: key('3') })).body.token;
  assert.equal((await api('POST', '/admin/users/action', { id: saraId, action: 'block' }, saraNow)).status, 403, 'non-admin cannot act');
  assert.equal((await api('POST', '/admin/users/action', { id: saraId, action: 'block' }, boss)).status, 200);
  assert.equal((await api('POST', '/auth/login', { email: 'sara@example.com', key: key('3') })).status, 403, 'blocked user cannot sign in');
  assert.equal((await api('POST', '/admin/users/action', { id: saraId, action: 'unblock' }, boss)).status, 200);
  assert.equal((await api('POST', '/auth/login', { email: 'sara@example.com', key: key('3') })).status, 200);

  // Profile, password change, account deletion
  r = await api('POST', '/auth/login', { email: 'sara@example.com', key: key('3') });
  const s3 = r.body.token;
  assert.equal((await api('POST', '/me', { name: 'سارا ک', avatar: 'javascript:alert(1)' }, s3)).status, 400, 'avatar must be an image');
  assert.equal((await api('POST', '/me', { name: 'سارا ک' }, s3)).body.user.name, 'سارا ک');
  assert.equal((await api('POST', '/me/password', { oldKey: key('1'), key: key('4') }, s3)).status, 401);
  assert.equal((await api('POST', '/me/password', { oldKey: key('3'), key: key('4') }, s3)).status, 200);
  assert.equal((await api('POST', '/me/delete', { key: key('3') }, s3)).status, 401);
  assert.equal((await api('POST', '/me/delete', { key: key('4') }, s3)).status, 200);
  assert.equal((await api('POST', '/auth/lookup', { email: 'sara@example.com' })).body.exists, false);
  // Brute force: 10 failures per hour per email
  for (let i = 0; i < 10; i += 1) assert.equal((await api('POST', '/auth/login', { email: 'nobody@example.com', key: key('7') })).status, 401);
  assert.equal((await api('POST', '/auth/login', { email: 'nobody@example.com', key: key('7') })).status, 429);
}

// Prompt layout: a one-paragraph answer gets headings and numbered items on their own lines; Persian punctuation is fixed.
{
  const blob = 'نقش و تخصص: به عنوان یک دستیار هوشمند متخصص عمل کنید که آماده کمک به کاربر در زمینه‌های مختلف است. هدف: پاسخ به سلام اولیه کاربر و اعلام آمادگی کامل. دستورالعمل‌های دقیق: 1. با یک سلام مؤدبانه پاسخ دهید. 2. آمادگی خود را اعلام کنید. محدودیت‌ها: پاسخ را کوتاه نگه دارید.';
  const out = formatPrompt(blob, 'fa');
  assert.ok(out.startsWith('نقش و تخصص:\nبه عنوان'), out);
  assert.ok(out.includes('\n\nهدف:\nپاسخ'), out);
  assert.ok(out.includes('دستورالعمل‌های دقیق:\n۱. با یک سلام مؤدبانه پاسخ دهید.\n۲. آمادگی'), out);
  assert.ok(out.includes('\n\nمحدودیت‌ها:\nپاسخ'), out);
  assert.equal(formatPrompt('سلام , خوبی ? این «متن» است .', 'fa'), 'سلام، خوبی؟ این «متن» است.');
  assert.equal(formatPrompt('Role:\nطراحی که کار می کند.\n\nExpected output:\nلوگو ها و بزرگ ترین طرح.', 'fa'),
    'نقش:\nطراحی که کار می\u200cکند.\n\nخروجی مورد انتظار:\nلوگو\u200cها و بزرگ\u200cترین طرح.');
  const laidOut = 'Role:\nYou are X.\n\nGoal:\nDo Y at 16:9.';
  assert.equal(formatPrompt(laidOut, 'en'), laidOut);
  assert.equal(formatPrompt('--ar 16:9, cinematic, soft light', 'en'), '--ar 16:9, cinematic, soft light');
}

console.log('worker tests passed');
