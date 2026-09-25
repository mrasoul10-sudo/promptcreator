// "Sign in with Google" via Google Identity Services (client-side only; no backend).

import { GOOGLE_CLIENT_ID } from './config.js?v=202609251412';
import { icon } from './ui.js?v=202609251412';

const GSI_SRC = 'https://accounts.google.com/gsi/client';

let loader = null;
let initialized = false;
let onCredential = null;

/** True inside the Android app shell (app-android/). */
export function inAndroidApp() {
  return /PromptSazApp/.test(navigator.userAgent);
}

/**
 * Google does not allow its web sign-in inside an app's WebView, so the Android app signs in natively
 * (Credential Manager, via the @capgo/capacitor-social-login plugin). Older APKs without the plugin get no button.
 */
function nativePlugin() {
  return inAndroidApp() ? window.Capacitor?.Plugins?.SocialLogin || null : null;
}

export function enabled() {
  return Boolean(GOOGLE_CLIENT_ID) && (!inAndroidApp() || Boolean(nativePlugin()));
}

let nativeReady = null;

/** Native sign-in in the Android app: resolves with Google's ID token (audience: the web client ID). */
async function nativeSignIn() {
  const plugin = nativePlugin();
  nativeReady ||= plugin.initialize({ google: { webClientId: GOOGLE_CLIENT_ID, mode: 'online' } });
  try {
    await nativeReady;
  } catch (err) {
    nativeReady = null;
    throw err;
  }
  const res = await plugin.login({ provider: 'google', options: { scopes: ['email', 'profile'] } });
  const token = res?.result?.idToken;
  if (!token) throw new Error('گوگل اطلاعات ورود را برنگرداند. دوباره تلاش کنید.');
  return token;
}

function renderNativeButton(container, callback, onError) {
  container.querySelector('.gsi-host')?.remove();
  const host = document.createElement('div');
  host.className = 'gsi-host';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn google-native';
  button.innerHTML = `${icon('google')}<span>ادامه با گوگل</span>`;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await callback(await nativeSignIn());
    } catch (err) {
      const text = String(err?.code || err?.message || '');
      if (/cancel/i.test(text)) return; // the user closed Google's account sheet
      console.error(err);
      onError?.(new Error(/28444|developer console|10:/i.test(text)
        ? 'ورود با گوگل در اپ هنوز راه‌اندازی نشده است. فعلاً با ایمیل وارد شوید.'
        : 'ورود با گوگل انجام نشد. مطمئن شوید یک حساب گوگل روی گوشی فعال است و دوباره تلاش کنید.'));
    } finally {
      button.disabled = false;
    }
  });
  host.appendChild(button);
  container.appendChild(host);
  container.classList.add('ready');
}

function load() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GSI_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loader = null;
      reject(new Error('سرویس ورود گوگل در دسترس نیست. اینترنت یا فیلترشکن را بررسی کنید.'));
    };
    document.head.appendChild(script);
  });
  return loader;
}

/** Renders Google's button into `container`; `callback(profile)` runs after a successful sign-in. */
export async function renderButton(container, callback, { theme = 'light', onError } = {}) {
  if (nativePlugin()) { renderNativeButton(container, callback, onError); return; }
  onCredential = callback;
  await load();
  if (!initialized) {
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (response) => onCredential?.(response.credential),
      ux_mode: 'popup',
      auto_select: false,
      context: 'signin',
      itp_support: true,
      // Chrome/Edge show the browser's own account chooser (FedCM) instead of a popup window, which avoids
      // popups that hang after "Continue" when the popup cannot message back; other browsers keep the popup.
      use_fedcm_for_button: true,
      use_fedcm_for_prompt: true,
    });
    initialized = true;
  }
  // Render into a host next to the skeleton; reveal only once Google's iframe has loaded, so its unstyled
  // placeholder (an oversized logo) never flashes on screen.
  container.classList.remove('ready');
  container.querySelector('.gsi-host')?.remove();
  const host = document.createElement('div');
  host.className = 'gsi-host';
  container.appendChild(host);
  const reveal = () => container.classList.add('ready');
  const watch = new MutationObserver(() => {
    const frame = host.querySelector('iframe');
    if (!frame) return;
    watch.disconnect();
    frame.addEventListener('load', () => setTimeout(reveal, 60), { once: true });
  });
  watch.observe(host, { childList: true, subtree: true });
  setTimeout(() => { watch.disconnect(); reveal(); }, 4000);
  window.google.accounts.id.renderButton(host, {
    type: 'standard',
    theme: theme === 'dark' ? 'filled_black' : 'outline',
    size: 'large',
    text: 'continue_with',
    shape: 'pill',
    logo_alignment: 'left',
    locale: 'fa',
    width: Math.max(220, Math.min(400, Math.floor(container.clientWidth || 320))),
  });
}

function decodeSegment(segment) {
  const b64 = segment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(segment.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * Reads the ID token issued to this page by Google. Without a server the signature cannot be verified,
 * so this only identifies the user for their local, in-browser account; it grants nothing server-side.
 */
export function parseCredential(credential) {
  let claims;
  try {
    claims = decodeSegment(String(credential).split('.')[1]);
  } catch {
    throw new Error('پاسخ گوگل قابل خواندن نبود.');
  }
  const now = Math.floor(Date.now() / 1000);
  if (claims.aud !== GOOGLE_CLIENT_ID) throw new Error('پاسخ گوگل برای این سایت صادر نشده است.');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) throw new Error('صادرکننده پاسخ گوگل نامعتبر است.');
  if (!claims.exp || claims.exp < now - 60) throw new Error('نشست گوگل منقضی شده است. دوباره تلاش کنید.');
  if (!claims.email || claims.email_verified === false) throw new Error('ایمیل حساب گوگل تأیید نشده است.');
  return {
    sub: String(claims.sub),
    email: String(claims.email),
    name: String(claims.name || claims.given_name || claims.email.split('@')[0]),
    picture: typeof claims.picture === 'string' && claims.picture.startsWith('https://') ? claims.picture : null,
  };
}
