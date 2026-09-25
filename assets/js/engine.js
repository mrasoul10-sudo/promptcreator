// Prompt engine: rewrites a rough idea (Persian or English) into a professional prompt via the Claude API.

import Anthropic from '../vendor/anthropic-sdk.js?v=202609250935';

export const MODELS = [
  { id: 'claude-opus-5', label: 'Claude Opus 5 — بالاترین کیفیت' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 — متعادل و سریع‌تر' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — سریع و ارزان' },
];

// Models that accept `output_config.effort`.
const EFFORT_MODELS = new Set(['claude-opus-5', 'claude-sonnet-5']);
// Models where server-side refusal fallbacks are enabled.
const FALLBACK_MODELS = new Set(['claude-opus-5']);

export const TARGETS = {
  general: { label: 'عمومی', hint: 'General-purpose assistant prompt (ChatGPT, Claude, Gemini).' },
  coding: { label: 'برنامه‌نویسی', hint: 'Software engineering task for a coding assistant or coding agent: role, context, requirements, constraints, deliverables, acceptance criteria, output format.' },
  image: { label: 'تصویر', hint: 'Text-to-image prompt (Midjourney, DALL·E, Flux, Imagen): subject, setting, style, medium, composition, lighting, color palette, camera/lens, mood, aspect ratio, and a short negative prompt. Write it as dense descriptive prose, not as instructions to an assistant.' },
  video: { label: 'ویدیو', hint: 'Text-to-video prompt (Veo, Sora, Kling, Runway): scene, subject action over time, camera movement, shot type, lighting, style, pacing, duration, audio/ambience. Describe it shot by shot when useful.' },
  writing: { label: 'نویسندگی و محتوا', hint: 'Writing or content task: audience, purpose, tone, structure, length, style references, what to avoid.' },
  research: { label: 'تحقیق و تحلیل', hint: 'Research or analysis task: question, scope, sources to prefer, method, how to handle uncertainty, deliverable structure, citations.' },
  marketing: { label: 'بازاریابی', hint: 'Marketing or sales copy: product, audience, pain points, value proposition, channel, tone, call to action, variants.' },
  agent: { label: 'ایجنت / System Prompt', hint: 'A system prompt for an AI agent or custom GPT: identity and role, goals, context, capabilities and tools, rules and boundaries, how to handle ambiguity, response format, examples of good behaviour.' },
};

export const LANGS = {
  en: 'انگلیسی',
  fa: 'فارسی',
  both: 'هر دو',
};

export const DETAILS = {
  concise: 'خلاصه',
  balanced: 'متعادل',
  detailed: 'جامع',
};

const DETAIL_GUIDE = {
  concise: 'Keep the prompt compact: only the essential sections, no filler (roughly 80-180 words).',
  balanced: 'Use a clear, moderately detailed structure (roughly 180-400 words).',
  detailed: 'Produce a comprehensive, fully specified prompt with every useful section (roughly 400-900 words).',
};

const SYSTEM_PROMPT = `You are Prompt Creator, an expert prompt engineer fluent in English and Persian (Farsi).

The user gives you a rough idea, request, or draft prompt, in Persian, English, or a mix of both. Your job is to rewrite it into a professional, high-performing prompt that another AI model can act on directly. You are not answering the request yourself; you are writing the prompt that will be sent to another model.

How to rewrite:
- Preserve the user's intent exactly. Never invent facts, names, numbers, or requirements they did not imply. Where an important detail is missing, add a clearly marked placeholder in square brackets, e.g. [target audience], rather than guessing.
- Use the vocabulary and structure that AI models respond to best: state the role or expertise the model should adopt, the task, the relevant context, requirements and constraints, the step-by-step approach when it helps, and the exact output format.
- Organize longer prompts with short headings or labelled sections; write short prompts as tight prose. Be specific and concrete. Remove vagueness, repetition, and politeness filler.
- Follow the guidance for the requested prompt type and detail level given in the user message.

Languages:
- prompt_en: the prompt in natural, idiomatic English, written as a native prompt engineer would write it (translate the meaning, do not translate word for word).
- prompt_fa: the same prompt in fluent, natural Persian that reads as if it had been written in Persian. Keep established technical terms, product names, code, and model parameters in English (for example API, JSON, React, aspect ratio values).
- The two versions must be equivalent in meaning and structure.
- When a language is not requested, return an empty string for that field.

Also return:
- title: a short descriptive title (at most 8 words) in the same language as the user's input.
- detected_language: "fa", "en", or "mixed".
- notes: 2 to 4 very short bullet points, in Persian, describing the key improvements you made.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    detected_language: { type: 'string', enum: ['fa', 'en', 'mixed'] },
    prompt_en: { type: 'string' },
    prompt_fa: { type: 'string' },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'detected_language', 'prompt_en', 'prompt_fa', 'notes'],
  additionalProperties: false,
};

function buildUserMessage(source, { type, lang, detail }) {
  const target = TARGETS[type] || TARGETS.general;
  const languages = { en: 'English only (prompt_fa must be "")', fa: 'Persian only (prompt_en must be "")', both: 'both English and Persian' }[lang] || 'both English and Persian';
  return `Prompt type: ${type}. ${target.hint}
Detail level: ${detail}. ${DETAIL_GUIDE[detail] || DETAIL_GUIDE.balanced}
Output language(s): ${languages}.

Rewrite the following input into a professional prompt:
<input>
${source}
</input>`;
}

export class EngineError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

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

/**
 * @param {string} source rough idea from the user
 * @param {{type:string, lang:string, detail:string}} options
 * @param {{apiKey:string, model:string, effort:string}} config
 * @param {AbortSignal} [signal]
 */
export async function generate(source, options, config, signal) {
  const text = String(source || '').trim();
  if (!text) throw new EngineError('متنی برای تبدیل وارد نشده است.', 'empty');
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
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new EngineError('پاسخ مدل قابل پردازش نبود. دوباره تلاش کنید.', 'parse');
  }

  return {
    title: String(data.title || '').trim(),
    detectedLanguage: data.detected_language || 'mixed',
    promptEn: options.lang === 'fa' ? '' : String(data.prompt_en || '').trim(),
    promptFa: options.lang === 'en' ? '' : String(data.prompt_fa || '').trim(),
    notes: Array.isArray(data.notes) ? data.notes.map(String).slice(0, 6) : [],
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
