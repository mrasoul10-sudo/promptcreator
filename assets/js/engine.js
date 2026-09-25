// Prompt engine: rewrites a rough idea (Persian or English) into a professional prompt.
// Default: the site's free service (Gemini behind worker/, no key needed). Optional: Claude with the user's own key.

import Anthropic from '../vendor/anthropic-sdk.js?v=202609251545';
import { FREE_API_URL } from './config.js?v=202609251545';
import {
  TARGETS, LANGS, DETAILS, SYSTEM_PROMPT, OUTPUT_SCHEMA, MAX_SOURCE_LENGTH,
  buildUserMessage, normalizeOptions, parseResult,
} from './prompt-spec.js?v=202609251545';
import { findInappropriate, INAPPROPRIATE_MESSAGE } from './moderation.js?v=202609251545';

export { TARGETS, LANGS, DETAILS };

export const ENGINES = {
  free: 'رایگان (Gemini)',
  claude: 'Claude با کلید شخصی',
};

export const MODELS = [
  { id: 'claude-opus-5', label: 'Claude Opus 5 — بالاترین کیفیت' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 — متعادل و سریع‌تر' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — سریع و ارزان' },
];

// Models that accept `output_config.effort`.
const EFFORT_MODELS = new Set(['claude-opus-5', 'claude-sonnet-5']);
// Models where server-side refusal fallbacks are enabled.
const FALLBACK_MODELS = new Set(['claude-opus-5']);

export class EngineError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

export function freeServiceReady() {
  return Boolean(FREE_API_URL);
}

/** Which engine a user's settings resolve to. */
export function engineFor(config) {
  return config.engine === 'claude' ? 'claude' : 'free';
}

/**
 * @param {string} source rough idea from the user
 * @param {{type:string, lang:string, detail:string}} options
 * @param {{engine?:string, apiKey?:string, model?:string, effort?:string}} config user settings
 * @param {AbortSignal} [signal]
 * @returns {Promise<{title, detectedLanguage, promptEn, promptFa, notes, model, usage, remaining?}>}
 */
export async function generate(source, options, config, signal) {
  const text = String(source || '').trim();
  if (!text) throw new EngineError('متنی برای تبدیل وارد نشده است.', 'empty');
  if (text.length > MAX_SOURCE_LENGTH) throw new EngineError('متن بیش از حد طولانی است.', 'too_long');
  if (findInappropriate(text).length) throw new EngineError(INAPPROPRIATE_MESSAGE, 'inappropriate');
  const opts = normalizeOptions(options);
  return engineFor(config) === 'claude' ? generateWithClaude(text, opts, config, signal) : generateFree(text, opts, signal);
}

// ---------- Free service (worker/) ----------

async function generateFree(text, options, signal) {
  if (!FREE_API_URL) throw new EngineError('سرویس رایگان هنوز راه‌اندازی نشده است. در تنظیمات «Claude با کلید شخصی» را انتخاب کنید.', 'not_configured');
  let res;
  try {
    res = await fetch(`${FREE_API_URL.replace(/\/+$/, '')}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: text, ...options }),
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw new EngineError('درخواست لغو شد.', 'aborted');
    throw new EngineError('اتصال به سرویس ساخت پرامپت برقرار نشد. اینترنت یا فیلترشکن را بررسی کنید.', 'connection');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) {
    throw new EngineError(body?.message || `خطای سرویس (${res.status}). کمی بعد دوباره تلاش کنید.`, body?.error || 'server');
  }
  // The worker already returns the normalized shape ({promptEn, promptFa, ...}); snake_case is accepted too.
  const r = body.result || {};
  const promptEn = options.lang === 'fa' ? '' : String(r.promptEn ?? r.prompt_en ?? '').trim();
  const promptFa = options.lang === 'en' ? '' : String(r.promptFa ?? r.prompt_fa ?? '').trim();
  if (!promptEn && !promptFa) throw new EngineError('پاسخی از سرویس دریافت نشد. دوباره تلاش کنید.', 'empty_result');
  return {
    title: String(r.title || '').trim(),
    detectedLanguage: r.detectedLanguage || r.detected_language || 'mixed',
    promptEn,
    promptFa,
    notes: Array.isArray(r.notes) ? r.notes.map(String).slice(0, 6) : [],
    model: String(body.model || 'gemini'),
    usage: body.usage || null,
    remaining: Number.isFinite(body.remaining) ? body.remaining : null,
  };
}

/** Today's remaining free generations for this visitor, or null if unknown. */
/** Voice input: sends a WAV recording to the free service, which returns it as clean written text. */
export async function transcribe(wav, signal) {
  if (!FREE_API_URL) throw new EngineError('سرویس تبدیل گفتار هنوز راه‌اندازی نشده است.', 'not_configured');
  let res;
  try {
    res = await fetch(`${FREE_API_URL.replace(/\/+$/, '')}/transcribe`, {
      method: 'POST',
      headers: { 'content-type': 'audio/wav' },
      body: wav,
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw new EngineError('درخواست لغو شد.', 'aborted');
    throw new EngineError('اتصال به سرویس تبدیل گفتار برقرار نشد. اینترنت را بررسی کنید.', 'connection');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new EngineError(body?.message || `خطای سرویس (${res.status}). کمی بعد دوباره تلاش کنید.`, body?.error || 'server');
  return { text: String(body?.text || '').trim(), language: body?.language || 'mixed' };
}

export async function freeQuota() {
  if (!FREE_API_URL) return null;
  try {
    const res = await fetch(`${FREE_API_URL.replace(/\/+$/, '')}/quota`);
    const body = await res.json();
    return Number.isFinite(body.remaining) ? { remaining: body.remaining, limit: body.limit } : null;
  } catch {
    return null;
  }
}

// ---------- Claude with the user's own key ----------

function translateError(err) {
  if (err instanceof EngineError) return err;
  if (err instanceof Anthropic.APIUserAbortError || err?.name === 'AbortError') return new EngineError('درخواست لغو شد.', 'aborted');
  if (err instanceof Anthropic.AuthenticationError) return new EngineError('کلید API نامعتبر است. در بخش تنظیمات آن را بررسی کنید.', 'auth');
  if (err instanceof Anthropic.PermissionDeniedError) return new EngineError('این کلید API به مدل انتخاب‌شده دسترسی ندارد.', 'permission');
  if (err instanceof Anthropic.NotFoundError) return new EngineError('مدل انتخاب‌شده پیدا نشد. مدل دیگری را در تنظیمات انتخاب کنید.', 'not_found');
  if (err instanceof Anthropic.RateLimitError) return new EngineError('محدودیت تعداد درخواست. چند لحظه بعد دوباره تلاش کنید.', 'rate_limit');
  if (err instanceof Anthropic.BadRequestError) {
    const msg = String(err.message || '');
    if (/credit balance/i.test(msg)) return new EngineError('اعتبار حساب API شما کافی نیست. در console.anthropic.com اعتبار اضافه کنید.', 'billing');
    return new EngineError(`درخواست نامعتبر: ${msg}`, 'bad_request');
  }
  if (err instanceof Anthropic.InternalServerError) return new EngineError('سرور Claude موقتاً در دسترس نیست. دوباره تلاش کنید.', 'server');
  if (err instanceof Anthropic.APIConnectionError) return new EngineError('اتصال به سرور Claude برقرار نشد. اینترنت یا فیلترشکن را بررسی کنید.', 'connection');
  if (err instanceof Anthropic.APIError) return new EngineError(`خطای API: ${err.message}`, 'api');
  return new EngineError(err?.message || 'خطای ناشناخته', 'unknown');
}

async function generateWithClaude(text, options, config, signal) {
  if (!config.apiKey) throw new EngineError('ابتدا کلید API را در بخش تنظیمات وارد کنید.', 'no_key');

  const client = new Anthropic({ apiKey: config.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  const model = config.model || 'claude-opus-5';

  const outputConfig = { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } };
  if (EFFORT_MODELS.has(model) && config.effort) outputConfig.effort = config.effort;

  const params = {
    model,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    output_config: outputConfig,
    messages: [{ role: 'user', content: buildUserMessage(text, options) }],
  };
  let message;
  try {
    if (FALLBACK_MODELS.has(model)) {
      const stream = client.beta.messages.stream(
        { ...params, fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'] },
        { signal },
      );
      message = await stream.finalMessage();
    } else {
      message = await client.messages.stream(params, { signal }).finalMessage();
    }
  } catch (err) {
    throw translateError(err);
  }

  if (message.stop_reason === 'refusal') {
    throw new EngineError('Claude این درخواست را به دلایل ایمنی رد کرد. متن را تغییر دهید و دوباره تلاش کنید.', 'refusal');
  }
  if (message.stop_reason === 'max_tokens') {
    throw new EngineError('پاسخ بیش از حد طولانی شد و ناقص ماند. سطح جزئیات را کمتر کنید.', 'max_tokens');
  }

  const raw = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let result;
  try {
    result = parseResult(raw, options);
  } catch {
    throw new EngineError('پاسخ مدل قابل پردازش نبود. دوباره تلاش کنید.', 'parse');
  }
  return {
    ...result,
    model: message.model || model,
    usage: {
      input: message.usage?.input_tokens || 0,
      output: message.usage?.output_tokens || 0,
    },
  };
}

/** Cheap connectivity check for the settings page. */
export async function testKey(apiKey) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0 });
  try {
    await client.models.list({ limit: 1 });
    return true;
  } catch (err) {
    throw translateError(err);
  }
}
