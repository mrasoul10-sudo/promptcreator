// Voice: speaking instead of typing, and reading prompts aloud.
//
// Speaking: tap the mic to record, tap again to stop. The recording is converted to a small WAV file and sent to
// the free service (worker POST /transcribe), where Gemini writes it down as clean, punctuated text in the language
// that was spoken (Persian, English or both). This avoids the browser's built-in speech recognition, which relies
// on Google's speech servers (unreachable from Iran) and needs a fixed language.
//
// Reading aloud: speechSynthesis in browsers; in the Android app, whose WebView lacks it, the native
// text-to-speech plugin (@capacitor-community/text-to-speech via window.Capacitor.Plugins).

import { transcribe, freeServiceReady } from './engine.js?v=202609251322';
import { MAX_AUDIO_SECONDS } from './prompt-spec.js?v=202609251322';

const nativeTts = () => (/PromptSazApp/.test(navigator.userAgent) ? window.Capacitor?.Plugins?.TextToSpeech || null : null);
const AudioCtx = window.AudioContext || window.webkitAudioContext;

export function canDictate() {
  return Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder && AudioCtx && window.OfflineAudioContext && freeServiceReady());
}

function browserSpeech() {
  return 'speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function';
}

export function canSpeak() {
  return Boolean(nativeTts()) || browserSpeech();
}

const ERRORS = {
  denied: 'اجازه دسترسی به میکروفون داده نشد. از تنظیمات مرورگر یا گوشی اجازه میکروفون را بدهید.',
  noMic: 'میکروفونی پیدا نشد.',
  short: 'صدایی ضبط نشد. روی میکروفون بزنید، صحبت کنید و برای پایان دوباره بزنید.',
  silent: 'صحبتی تشخیص داده نشد. کمی بلندتر و نزدیک‌تر به میکروفون صحبت کنید.',
  failed: 'تبدیل گفتار به متن انجام نشد. دوباره تلاش کنید.',
};

/** Decodes a recording and re-encodes it as 16 kHz mono 16-bit PCM WAV (small, and accepted by Gemini). */
async function toWav(blob) {
  const ctx = new AudioCtx();
  let decoded;
  try {
    decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  } finally {
    ctx.close?.();
  }
  const rate = 16000;
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const pcm = (await offline.startRendering()).getChannelData(0);
  const view = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const text = (offset, str) => { for (let i = 0; i < str.length; i += 1) view.setUint8(offset + i, str.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i += 1) {
    const x = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Blob([view.buffer], { type: 'audio/wav' });
}

let session = null;

/**
 * Starts recording. The returned stop() ends the recording and writes it down; stopDictation() cancels it.
 * onState('recording' | 'processing'), onText(text) with the clean text, onEnd(errorMessage | null) once at the end.
 * Recording stops by itself after MAX_AUDIO_SECONDS.
 */
export function dictate({ onState, onText, onEnd }) {
  stopDictation();
  const s = { cancelled: false, stopRequested: false, stop() { this.stopRequested = true; } };
  session = s;
  (async () => {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (err) {
      if (session === s) session = null;
      onEnd?.(err?.name === 'NotAllowedError' || err?.name === 'SecurityError' ? ERRORS.denied : ERRORS.noMic);
      return;
    }
    if (s.cancelled) { stream.getTracks().forEach((t) => t.stop()); onEnd?.(null); return; }
    const chunks = [];
    const recorder = new MediaRecorder(stream);
    const startedAt = Date.now();
    recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    recorder.onstop = async () => {
      clearTimeout(s.timer);
      stream.getTracks().forEach((t) => t.stop());
      if (s.cancelled) { if (session === s) session = null; onEnd?.(null); return; }
      if (Date.now() - startedAt < 700 || !chunks.length) { if (session === s) session = null; onEnd?.(ERRORS.short); return; }
      onState?.('processing');
      try {
        const wav = await toWav(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
        const { text } = await transcribe(wav);
        if (s.cancelled) return;
        if (!text) onEnd?.(ERRORS.silent);
        else { onText?.(text); onEnd?.(null); }
      } catch (err) {
        console.error(err);
        if (!s.cancelled) onEnd?.(err?.message || ERRORS.failed);
      } finally {
        if (session === s) session = null;
      }
    };
    s.stop = () => { if (recorder.state !== 'inactive') recorder.stop(); };
    recorder.start(1000);
    onState?.('recording');
    s.timer = setTimeout(() => s.stop(), MAX_AUDIO_SECONDS * 1000);
    if (s.stopRequested) s.stop();
  })();
  return () => s.stop();
}

/** Cancels a recording or a pending transcription (e.g. when leaving the page); nothing is written. */
export function stopDictation() {
  if (!session) return;
  const s = session;
  session = null;
  s.cancelled = true;
  s.stop();
}

function voiceFor(lang) {
  const voices = speechSynthesis.getVoices();
  const prefix = lang.slice(0, 2);
  return voices.find((v) => v.lang?.toLowerCase().startsWith(prefix)) || null;
}

async function speakNative(text, lang) {
  const tts = nativeTts();
  const { supported } = await tts.isLanguageSupported({ lang }).catch(() => ({ supported: true }));
  if (!supported) {
    throw new Error(lang.startsWith('fa')
      ? 'صدای فارسی روی این گوشی نصب نیست. در تنظیمات گوشی، «خروجی متن به گفتار» را روی Google بگذارید و زبان فارسی را نصب کنید، یا نسخه انگلیسی را بخوانید.'
      : 'این زبان روی موتور گفتار گوشی نصب نیست.');
  }
  try {
    await tts.speak({ text, lang, rate: 1, pitch: 1, volume: 1, category: 'playback' });
  } catch (err) {
    if (!/interrupt|stop|cancel/i.test(String(err?.message))) throw new Error('خواندن متن متوقف شد.');
  }
}

/** Reads `text` aloud. Resolves when finished or stopped; rejects with a Persian message if impossible. */
export function speak(text, lang = 'fa-IR') {
  if (nativeTts()) return speakNative(text, lang);
  return new Promise((resolve, reject) => {
    if (!browserSpeech()) { reject(new Error('مرورگر شما خواندن متن را پشتیبانی نمی‌کند.')); return; }
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
  if (nativeTts()) { nativeTts().stop().catch(() => {}); return; }
  if (browserSpeech()) speechSynthesis.cancel();
}

export function speaking() {
  return browserSpeech() && speechSynthesis.speaking;
}
