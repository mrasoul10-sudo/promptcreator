// Voice: dictation into the composer (Web Speech API) and reading prompts aloud (speechSynthesis).
// Both are browser features; they are hidden where unsupported (e.g. Firefox, Android WebView).

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export function canDictate() {
  return Boolean(Recognition);
}

export function canSpeak() {
  return 'speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function';
}

const ERRORS = {
  'not-allowed': 'اجازه دسترسی به میکروفون داده نشد. از تنظیمات مرورگر اجازه میکروفون را بدهید.',
  'service-not-allowed': 'مرورگر اجازه تشخیص گفتار را نمی‌دهد.',
  'audio-capture': 'میکروفونی پیدا نشد.',
  network: 'سرویس تشخیص گفتار مرورگر در دسترس نیست. اینترنت یا فیلترشکن را بررسی کنید.',
  'language-not-supported': 'تشخیص گفتار برای این زبان در مرورگر شما پشتیبانی نمی‌شود.',
};

let active = null;

/**
 * Starts dictation. `onText(finalText, interimText)` receives the text recognised so far in this session;
 * `onEnd(errorMessage?)` runs once when listening stops. Returns a stop() function.
 */
export function dictate({ lang = 'fa-IR', onText, onEnd }) {
  stopDictation();
  const rec = new Recognition();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;
  let finalText = '';
  let error = null;
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i += 1) {
      const chunk = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += `${finalText && !finalText.endsWith(' ') ? ' ' : ''}${chunk.trim()}`;
      else interim += chunk;
    }
    onText?.(finalText, interim.trim());
  };
  rec.onerror = (e) => {
    if (e.error !== 'no-speech' && e.error !== 'aborted') error = ERRORS[e.error] || 'تشخیص گفتار با خطا متوقف شد.';
  };
  rec.onend = () => {
    if (active === rec) active = null;
    onEnd?.(error);
  };
  active = rec;
  try {
    rec.start();
  } catch {
    active = null;
    onEnd?.('شروع تشخیص گفتار ممکن نشد.');
  }
  return () => rec.stop();
}

export function stopDictation() {
  if (active) {
    try { active.stop(); } catch { /* already stopped */ }
    active = null;
  }
}

function voiceFor(lang) {
  const voices = speechSynthesis.getVoices();
  const prefix = lang.slice(0, 2);
  return voices.find((v) => v.lang?.toLowerCase().startsWith(prefix)) || null;
}

/** Reads `text` aloud. Resolves when finished or stopped; rejects with a Persian message if impossible. */
export function speak(text, lang = 'fa-IR') {
  return new Promise((resolve, reject) => {
    if (!canSpeak()) { reject(new Error('مرورگر شما خواندن متن را پشتیبانی نمی‌کند.')); return; }
    speechSynthesis.cancel();
    const start = () => {
      const voice = voiceFor(lang);
      if (!voice && lang.startsWith('fa')) {
        reject(new Error('صدای فارسی روی این دستگاه نصب نیست. نسخه انگلیسی را امتحان کنید یا صدای فارسی را در تنظیمات دستگاه نصب کنید.'));
        return;
      }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      if (voice) u.voice = voice;
      u.rate = 1;
      u.onend = () => resolve();
      u.onerror = (e) => (e.error === 'interrupted' || e.error === 'canceled' ? resolve() : reject(new Error('خواندن متن متوقف شد.')));
      speechSynthesis.speak(u);
    };
    // Voices load asynchronously in some browsers.
    if (speechSynthesis.getVoices().length) start();
    else {
      let done = false;
      const once = () => { if (!done) { done = true; start(); } };
      speechSynthesis.addEventListener('voiceschanged', once, { once: true });
      setTimeout(once, 800);
    }
  });
}

export function stopSpeaking() {
  if (canSpeak()) speechSynthesis.cancel();
}

export function speaking() {
  return canSpeak() && speechSynthesis.speaking;
}
