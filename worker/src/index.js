// Prompt Creator free API — a Cloudflare Worker that turns a rough idea into a professional prompt with Gemini.
// The Gemini key lives only here (secret GEMINI_API_KEY); visitors need no key. Daily limits protect the free quota.
//
// Endpoints:
//   GET  /health    -> { ok, model }
//   GET  /quota     -> { remaining, limit }            (for the calling visitor, today)
//   POST /generate  -> { result, model, usage, remaining }
//        body: { source, type, lang, detail }

import {
  SYSTEM_PROMPT, OUTPUT_SCHEMA, MAX_SOURCE_LENGTH, buildUserMessage, normalizeOptions, parseResult,
} from '../../assets/js/prompt-spec.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// ---------- Helpers ----------

function allowedOrigin(request, env) {
  const origin = request.headers.get('origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : null;
}

function json(body, status, origin) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', vary: 'origin' };
  if (origin) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-methods'] = 'GET, POST, OPTIONS';
    headers['access-control-allow-headers'] = 'content-type';
    headers['access-control-max-age'] = '86400';
  }
  return new Response(body === null ? null : JSON.stringify(body), { status, headers });
}

function fail(status, error, message, origin, extra = {}) {
  return json({ error, message, ...extra }, status, origin);
}

function today() {
  return new Date().toISOString().slice(0, 10); // UTC day
}

/** Visitors are counted by a salted hash of their IP; the raw IP is never stored. */
async function visitorId(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const data = new TextEncoder().encode(`${env.IP_SALT || 'promptcreator'}:${ip}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function limits(env) {
  return {
    perVisitor: Number(env.DAILY_LIMIT_PER_VISITOR) || 20,
    global: Number(env.DAILY_LIMIT_GLOBAL) || 900,
    perMinute: Number(env.PER_MINUTE_LIMIT_GLOBAL) || 8,
  };
}

function quotaStub(env) {
  return env.QUOTA.get(env.QUOTA.idFromName('global'));
}

async function quotaCall(env, action, payload) {
  const res = await quotaStub(env).fetch(`https://quota/${action}`, { method: 'POST', body: JSON.stringify(payload) });
  return res.json();
}

// ---------- Gemini ----------

// Gemini's responseSchema uses an OpenAPI subset: upper-case type names, no `additionalProperties`.
function geminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'additionalProperties') continue;
    if (k === 'type' && typeof v === 'string') out.type = v.toUpperCase();
    else if (k === 'properties') out.properties = Object.fromEntries(Object.entries(v).map(([name, sub]) => [name, geminiSchema(sub)]));
    else out[k] = typeof v === 'object' ? geminiSchema(v) : v;
  }
  return out;
}

const RESPONSE_SCHEMA = geminiSchema(OUTPUT_SCHEMA);

class UpstreamError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function callGemini(env, model, source, options) {
  const res = await fetch(`${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: buildUserMessage(source, options) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        maxOutputTokens: 8192,
      },
    }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = body?.error?.message || `HTTP ${res.status}`;
    if (res.status === 429) throw new UpstreamError(429, 'upstream_busy', detail);
    if (res.status === 404) throw new UpstreamError(404, 'model_not_found', detail);
    if (res.status === 400 || res.status === 403) throw new UpstreamError(res.status, 'upstream_rejected', detail);
    throw new UpstreamError(502, 'upstream_error', detail);
  }
  if (body?.promptFeedback?.blockReason) throw new UpstreamError(422, 'blocked', body.promptFeedback.blockReason);
  const candidate = body?.candidates?.[0];
  if (!candidate) throw new UpstreamError(502, 'empty', 'no candidates');
  if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'PROHIBITED_CONTENT') throw new UpstreamError(422, 'blocked', candidate.finishReason);
  if (candidate.finishReason === 'MAX_TOKENS') throw new UpstreamError(422, 'too_long', 'max tokens');
  const text = (candidate.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
  let result;
  try {
    result = parseResult(text, options);
  } catch {
    throw new UpstreamError(502, 'parse', 'invalid JSON from model');
  }
  if (!result.promptEn && !result.promptFa) throw new UpstreamError(502, 'empty', 'empty prompt');
  return {
    result,
    model: body.modelVersion || model,
    usage: { input: body.usageMetadata?.promptTokenCount || 0, output: body.usageMetadata?.candidatesTokenCount || 0 },
  };
}

const USER_MESSAGES = {
  upstream_busy: 'سرویس رایگان در این لحظه شلوغ است. یک دقیقه بعد دوباره تلاش کنید.',
  model_not_found: 'مدل هوش مصنوعی سرویس در دسترس نیست. به مدیر سایت اطلاع دهید.',
  upstream_rejected: 'سرویس هوش مصنوعی درخواست را نپذیرفت. به مدیر سایت اطلاع دهید.',
  upstream_error: 'سرویس هوش مصنوعی موقتاً در دسترس نیست. کمی بعد دوباره تلاش کنید.',
  blocked: 'این متن توسط فیلتر ایمنی رد شد. متن را تغییر دهید و دوباره تلاش کنید.',
  too_long: 'پاسخ بیش از حد طولانی شد. سطح جزئیات را کمتر کنید.',
  parse: 'پاسخ مدل قابل پردازش نبود. دوباره تلاش کنید.',
  empty: 'مدل پاسخی نداد. دوباره تلاش کنید.',
};

// ---------- Handlers ----------

async function handleGenerate(request, env, origin) {
  if (!env.GEMINI_API_KEY) return fail(503, 'not_configured', 'سرویس رایگان هنوز پیکربندی نشده است.', origin);
  const type = request.headers.get('content-type') || '';
  if (!type.includes('application/json')) return fail(415, 'bad_request', 'درخواست نامعتبر است.', origin);
  const payload = await request.json().catch(() => null);
  const source = typeof payload?.source === 'string' ? payload.source.trim() : '';
  if (!source) return fail(400, 'empty', 'متنی برای تبدیل وارد نشده است.', origin);
  if (source.length > MAX_SOURCE_LENGTH) return fail(413, 'too_long', 'متن بیش از حد طولانی است.', origin);
  const options = normalizeOptions(payload);

  const visitor = await visitorId(request, env);
  const quota = await quotaCall(env, 'consume', { visitor, day: today(), limits: limits(env) });
  if (!quota.ok) {
    const message = quota.reason === 'visitor'
      ? `سهمیه رایگان امروز شما (${quota.limit} پرامپت) تمام شده است. فردا دوباره امتحان کنید.`
      : quota.reason === 'minute'
        ? 'درخواست‌ها زیاد است. یک دقیقه بعد دوباره تلاش کنید.'
        : 'سهمیه رایگان امروز سایت تمام شده است. فردا دوباره امتحان کنید.';
    return fail(429, 'quota', message, origin, { remaining: 0 });
  }

  const models = [env.GEMINI_MODEL || 'gemini-flash-latest', env.GEMINI_FALLBACK_MODEL].filter(Boolean);
  let lastError;
  for (const model of models) {
    try {
      const out = await callGemini(env, model, source, options);
      return json({ ...out, remaining: quota.remaining }, 200, origin);
    } catch (err) {
      lastError = err;
      // Only a busy, missing or temporarily failing model is worth retrying on the fallback model.
      if (!(err instanceof UpstreamError) || !['upstream_busy', 'model_not_found', 'upstream_error'].includes(err.code)) break;
    }
  }
  await quotaCall(env, 'refund', { visitor, day: today() });
  const code = lastError instanceof UpstreamError ? lastError.code : 'upstream_error';
  console.error('generate failed', code, lastError?.message);
  // `detail` carries Gemini's own error text (never the key) so the site owner can diagnose failures.
  const detail = String(lastError?.message || '').replace(/key=[^&\s]+/gi, 'key=***').slice(0, 300);
  return fail(lastError?.status || 502, code, USER_MESSAGES[code] || USER_MESSAGES.upstream_error, origin, { detail });
}

async function handleQuota(request, env, origin) {
  const visitor = await visitorId(request, env);
  const q = await quotaCall(env, 'peek', { visitor, day: today(), limits: limits(env) });
  return json(q, 200, origin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = allowedOrigin(request, env);
    // Browsers always send Origin on cross-origin calls; refuse other sites so they cannot spend this quota.
    if (request.headers.get('origin') && !origin) return fail(403, 'forbidden_origin', 'دسترسی از این دامنه مجاز نیست.', null);
    if (request.method === 'OPTIONS') return json(null, 204, origin);
    if (url.pathname === '/health') return json({ ok: true, model: env.GEMINI_MODEL || 'gemini-flash-latest', configured: Boolean(env.GEMINI_API_KEY) }, 200, origin);
    if (url.pathname === '/quota' && request.method === 'GET') return handleQuota(request, env, origin);
    if (url.pathname === '/generate' && request.method === 'POST') return handleGenerate(request, env, origin);
    return fail(404, 'not_found', 'Not found', origin);
  },
};

// ---------- Quota counter (Durable Object, SQLite-backed, single instance) ----------

export class Quota {
  constructor(state) {
    this.storage = state.storage;
  }

  async fetch(request) {
    const action = new URL(request.url).pathname.slice(1);
    const { visitor, day, limits: lim } = await request.json();
    const vKey = `v:${day}:${visitor}`;
    const gKey = `g:${day}`;
    const minute = Math.floor(Date.now() / 60000);
    const mKey = `m:${minute}`;
    const [v = 0, g = 0, m = 0] = await Promise.all([this.storage.get(vKey), this.storage.get(gKey), this.storage.get(mKey)]);

    if (action === 'peek') {
      return Response.json({ remaining: Math.max(0, Math.min(lim.perVisitor - v, lim.global - g)), limit: lim.perVisitor });
    }
    if (action === 'refund') {
      await this.storage.put({ [vKey]: Math.max(0, v - 1), [gKey]: Math.max(0, g - 1) });
      return Response.json({ ok: true });
    }
    // consume
    if (v >= lim.perVisitor) return Response.json({ ok: false, reason: 'visitor', limit: lim.perVisitor });
    if (g >= lim.global) return Response.json({ ok: false, reason: 'global' });
    if (m >= lim.perMinute) return Response.json({ ok: false, reason: 'minute' });
    await this.storage.put({ [vKey]: v + 1, [gKey]: g + 1, [mKey]: m + 1 });
    await this.cleanup(day, minute);
    return Response.json({ ok: true, remaining: Math.max(0, Math.min(lim.perVisitor - v - 1, lim.global - g - 1)) });
  }

  /** Drops counters from previous days/minutes, at most once per minute. */
  async cleanup(day, minute) {
    if (this.lastCleanup === minute) return;
    this.lastCleanup = minute;
    const stale = [];
    for (const key of (await this.storage.list()).keys()) {
      if ((key.startsWith('v:') || key.startsWith('g:')) && !key.startsWith(`v:${day}:`) && key !== `g:${day}`) stale.push(key);
      if (key.startsWith('m:') && Number(key.slice(2)) < minute) stale.push(key);
    }
    for (let i = 0; i < stale.length; i += 128) await this.storage.delete(stale.slice(i, i + 128));
  }
}
