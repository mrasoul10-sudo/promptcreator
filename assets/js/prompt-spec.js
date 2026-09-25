// Prompt specification shared by the browser (assets/js/engine.js) and the free API server (worker/src/index.js):
// the system prompt, per-type guidance, output schema and result normalization. Keep it dependency-free.

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

export const DETAIL_GUIDE = {
  concise: 'Keep the prompt compact: only the essential sections, no filler (roughly 80-180 words).',
  balanced: 'Use a clear, moderately detailed structure (roughly 180-400 words).',
  detailed: 'Produce a comprehensive, fully specified prompt with every useful section (roughly 400-900 words).',
};

export const SYSTEM_PROMPT = `You are Prompt Creator, an expert prompt engineer fluent in English and Persian (Farsi).

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

export const OUTPUT_SCHEMA = {
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

export function buildUserMessage(source, { type, lang, detail }) {
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

export const MAX_SOURCE_LENGTH = 20000;

/** Validates and normalizes the generation options sent by a client. */
export function normalizeOptions({ type, lang, detail } = {}) {
  return {
    type: Object.hasOwn(TARGETS, type) ? type : 'general',
    lang: Object.hasOwn(LANGS, lang) ? lang : 'both',
    detail: Object.hasOwn(DETAILS, detail) ? detail : 'balanced',
  };
}

/** Parses the model's JSON text (tolerating a Markdown code fence) into the app's result shape. */
export function parseResult(raw, options) {
  const text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const data = JSON.parse(text);
  return {
    title: String(data.title || '').trim(),
    detectedLanguage: ['fa', 'en', 'mixed'].includes(data.detected_language) ? data.detected_language : 'mixed',
    promptEn: options.lang === 'fa' ? '' : String(data.prompt_en || '').trim(),
    promptFa: options.lang === 'en' ? '' : String(data.prompt_fa || '').trim(),
    notes: Array.isArray(data.notes) ? data.notes.map(String).slice(0, 6) : [],
  };
}
