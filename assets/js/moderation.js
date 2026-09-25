// Inappropriate-language filter shared by the browser (before sending) and the worker (enforced server-side).
// Matching is per word after normalization, so ordinary words that merely contain a bad substring
// (e.g. «عکس», «اکنون», "Dickens") are not flagged. Obfuscation such as repeated letters («کیییر»),
// inner punctuation («ک.ی.ر») or Arabic letter variants is undone before matching.

// Persian and English profanity, sexual and hateful terms. Stored in normalized form (see normalizeWord).
const BLOCKED = [
  // Persian
  'کیر', 'کیری', 'کیرم', 'کیرت', 'کیرخور', 'کون', 'کونی', 'کونده', 'کونکش', 'کس‌کش', 'کسکش', 'کصکش', 'کسخل', 'کصخل',
  'کسده', 'خارکسده', 'کسمادر', 'کصمادر', 'کسننه', 'جنده', 'جندگی', 'مادرجنده', 'ننه‌جنده', 'ننه جنده', 'حرومزاده',
  'حرامزاده', 'حرومی', 'بیناموس', 'بی‌ناموس', 'لاشی', 'جاکش', 'دیوث', 'گاییدم', 'گاییدن', 'بگا', 'میگام', 'گایید',
  'سکس', 'سکسی', 'پورن', 'پورنو', 'شهوانی', 'تخمی', 'تخم‌سگ', 'پدرسگ', 'پدرسوخته', 'کثافت', 'عوضی',
  // Finglish / English
  'kir', 'kos', 'koskesh', 'jende', 'jakesh', 'kooni', 'fuck', 'fucking', 'fucker', 'motherfucker', 'shit', 'bitch',
  'bastard', 'cunt', 'dick', 'cock', 'pussy', 'whore', 'slut', 'asshole', 'porn', 'porno', 'nigger', 'nigga', 'faggot', 'rape',
];

const ARABIC_TO_PERSIAN = { 'ي': 'ی', 'ى': 'ی', 'ك': 'ک', 'ة': 'ه', 'ۀ': 'ه', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ؤ': 'و' };

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '') // harakat and tatweel
    .replace(/[يىكةۀأإآؤ]/g, (c) => ARABIC_TO_PERSIAN[c])
    .replace(/[0@]/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/\$/g, 's');
}

/** Removes joiners and inner punctuation, then collapses repeated letters ("fuuuck" -> "fuck"). */
function normalizeWord(word) {
  return normalizeText(word)
    .replace(/[‌‍\s.\-_*'"`~^+=]/g, '')
    .replace(/(.)\1+/gu, '$1');
}

const BLOCKED_SET = new Set(BLOCKED.map(normalizeWord));

/** Returns the distinct inappropriate words found in `text` (empty array when clean). */
export function findInappropriate(text) {
  const normalized = normalizeText(text);
  const found = new Set();
  // Words separated by whitespace or punctuation (ZWNJ-joined parts stay together, so «ننه‌جنده» is one word).
  const words = normalized.split(/[\s،,;:!?؟«»()[\]{}<>/\\"“”]+/u).filter(Boolean);
  for (const w of words) {
    const n = normalizeWord(w);
    if (n && BLOCKED_SET.has(n)) found.add(w);
  }
  // Letters spaced out to dodge the filter: "ک ی ر" / "f u c k".
  const singles = normalized.split(/\s+/u);
  for (let i = 0; i < singles.length; i += 1) {
    if ([...singles[i]].length !== 1) continue;
    let joined = '';
    for (let j = i; j < singles.length && [...singles[j]].length === 1; j += 1) {
      joined += singles[j];
      if (j > i && BLOCKED_SET.has(normalizeWord(joined))) found.add(joined);
    }
  }
  return [...found];
}

export const INAPPROPRIATE_MESSAGE = 'متن شما شامل کلمات نامناسب یا توهین‌آمیز است و برای آن پرامپت ساخته نمی‌شود. لطفاً متن را اصلاح کنید.';
