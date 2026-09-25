// Prompt specification shared by the browser (assets/js/engine.js) and the free API server (worker/src/index.js):
// the system prompt, per-type guidance, output schema and result normalization. Keep it dependency-free.

export const TARGETS = {
  auto: { label: 'تشخیص خودکار', hint: 'Infer the most suitable prompt type from the input (a software/app change request or coding task, image, video, writing, research, marketing, an AI agent system prompt, or general) and apply that type\'s conventions. A request to change or build an app, website, UI, table, feature or code is a coding task.' },
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

The user gives you a rough idea, request, note, or draft prompt, in Persian, English, or a mix of both. It is often informal, colloquial, misspelled, run-on, or disorganized. Your job is to transform it into a professional, well-structured prompt that another AI model (a chatbot, a coding agent, an image or video model) can act on directly and unambiguously. You are not answering or carrying out the request yourself; you are writing the prompt that will be given to another model.

The rewrite must be a substantial improvement, never a copy:
- Never return the input verbatim or only lightly edited. Even when the input is already long and detailed, restructure it.
- Fix spelling, grammar, punctuation and half-space (ZWNJ) usage, and turn colloquial or spoken phrasing into clear, standard written language.
- Split run-on sentences. Group related points under short headings and turn requirements into numbered items, one idea per item, each specific and testable.
- Open with the role or expertise the target model should adopt and a one-sentence statement of the goal, then the context, the detailed requirements, constraints (what must not change or must be avoided), and the expected output or acceptance criteria.
- Make implicit expectations explicit and resolve ambiguity from context. For example "X and Y are separate products, do not add them together" becomes an explicit rule.

Stay faithful:
- Preserve every requirement, detail, name and number the user gave, and their intent. Never drop information.
- Never invent facts, names, numbers or requirements the user did not state or clearly imply. Where an important detail is missing, add a placeholder in square brackets, e.g. [target audience], instead of guessing.
- Remove only filler, repetition and politeness.
- Follow the guidance for the requested prompt type and detail level given in the user message. The detail level controls how much you expand; it never allows dropping the user's own details.

Languages:
- prompt_en: the prompt in natural, idiomatic English, written as a native prompt engineer would write it (translate the meaning, not word for word).
- prompt_fa: the same prompt in fluent, formal written Persian (نثر رسمی و روان), not colloquial, reading as if originally written in Persian, with correct half-spaces. Keep established technical terms, product names, code identifiers and model parameters in English (for example API, JSON, React, --ar 16:9).
- The two versions must be equivalent in meaning and structure.
- When a language is not requested, return an empty string for that field.

Layout inside prompt_en and prompt_fa (plain text; use real line breaks, "\n", inside the JSON strings):
- Never write the prompt as one paragraph. Every section starts with a short heading on its own line ending with a colon (for example "Role:", "Goal:", "Context:", "Instructions:", "Constraints:", "Expected output:"), and its content starts on the next line.
- Put one blank line between sections.
- Each numbered item ("1.", "2.") and each "-" bullet on its own line. Several requirements in a section are always a list, never a run-on sentence.
- No Markdown bold, tables or code fences unless the prompt itself needs code.
- Layout example:
Role:
You are a senior front-end developer.

Goal:
Fix the layout of the report page.

Instructions:
1. Put the filters on one line.
2. Keep the existing data unchanged.

Persian writing rules for prompt_fa (رعایت دقیق نگارش فارسی، مطابق شیوه‌نامه فرهنگستان):
- Half-space (ZWNJ, U+200C) for prefixes, suffixes and compounds: می‌کند، نمی‌شود، کتاب‌ها، بزرگ‌ترین، به‌عنوان، به‌صورت، درخواست‌شده، ساده‌تر.
- Persian punctuation: «،» for commas, «؛» for semicolons, «؟» for questions, «» for quotes. No space before a punctuation mark and one space after it.
- Persian digits in Persian text and list numbers (۱. ۲. ۳.); keep code, parameters and technical values as written (for example --ar 16:9).
- Correct spelling and standard written forms, short clear sentences, consistent verb tense and a formal tone throughout.

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
  const target = TARGETS[type] || TARGETS.auto;
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
    type: Object.hasOwn(TARGETS, type) ? type : 'auto',
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
    promptEn: options.lang === 'fa' ? '' : formatPrompt(data.prompt_en, 'en'),
    promptFa: options.lang === 'en' ? '' : formatPrompt(data.prompt_fa, 'fa'),
    notes: Array.isArray(data.notes) ? data.notes.map(String).slice(0, 6) : [],
  };
}

const toPersianDigits = (t) => t.replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

/**
 * Tidies a generated prompt's layout and, for Persian, its punctuation. Models sometimes return the whole
 * prompt as one paragraph; then section headings ("Goal:", «هدف:») and numbered items are moved onto their
 * own lines. Text that already has line breaks keeps its layout. Text containing code fences is left as is.
 */
export function formatPrompt(text, lang) {
  let t = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!t || t.includes('```')) return t;
  if ((t.match(/\n/g) || []).length < 2 && t.length > 150) {
    // Numbered items after a sentence end or a colon: "... دقیق: 1. با ... 2. به ..."
    t = t.replace(/([.:!?؟؛])[ \t]+(?=(?:\d{1,2}|[۰-۹]{1,2})[.)][ \t])/gu, '$1\n');
    // Headings of up to five words that end with a colon: at the start or after a sentence end.
    t = t.replace(/^((?:[^\s:.،؛!?؟]+[ \t]+){0,4}[^\s:.،؛!?؟]+):[ \t]+/u, '$1:\n');
    t = t.replace(/([.!?؟])[ \t]+((?:[^\s:.،؛!?؟]+[ \t]+){0,4}[^\s:.،؛!?؟\d۰-۹]+):[ \t]*\n?/gu, '$1\n\n$2:\n');
  }
  if (lang === 'fa') {
    t = t
      .replace(/([\u0600-\u06FF])[ \t]*,[ \t]*/g, '$1، ')
      .replace(/([\u0600-\u06FF])[ \t]*\?/g, '$1؟')
      .replace(/([\u0600-\u06FF])[ \t]*;[ \t]*/g, '$1؛ ')
      .replace(/[ \t]+([،؛؟!»)])/g, '$1')
      .replace(/([\u0600-\u06FF»)])[ \t]+([.:])(?=\s|$)/g, '$1$2')
      .replace(/([،؛؟])(?=[\u0600-\u06FF«])/g, '$1 ')
      .replace(/^([ \t]*)(\d{1,2})([.)-])(?=[ \t])/gm, (m, sp, n, p) => sp + toPersianDigits(n) + p);
  }
  return t
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * True when the model mostly echoed the input instead of rewriting it (character-trigram overlap).
 * Used to retry once with a stronger instruction.
 */
export function isEcho(source, result) {
  const norm = (t) => String(t || '').replace(/[\s\u200c.,،:;!?؟«»"'()\-]+/g, '').toLowerCase();
  const grams = (t) => {
    const set = new Set();
    for (let i = 0; i < t.length - 2; i += 1) set.add(t.slice(i, i + 3));
    return set;
  };
  const a = norm(source);
  if (a.length < 40) return false;
  return [result.promptFa, result.promptEn].some((out) => {
    const b = norm(out);
    if (!b) return false;
    const ga = grams(a);
    const gb = grams(b);
    let shared = 0;
    for (const g of gb) if (ga.has(g)) shared += 1;
    // Most of the output already existed in the input, and the output is not much longer.
    return shared / Math.max(gb.size, 1) > 0.85 && b.length < a.length * 1.3;
  });
}

export const ECHO_RETRY_NOTE = 'Your previous answer repeated the input almost unchanged. That is not acceptable. Rewrite it now as a clearly structured, professional prompt: a role line, a goal sentence, headings, numbered requirements, corrected formal language, and acceptance criteria.';
