// "What's new" popup after a release, and the Android app's "new version available" prompt.
// Add a CHANGELOG entry (newest first, id + 1) for every user-visible release.

import { esc, icon, modal } from './ui.js?v=202609251532';
import { ANDROID_APK_URL } from './config.js?v=202609251532';

export const CHANGELOG = [
  {
    id: 6,
    date: '۳ مهر ۱۴۰۵',
    items: [
      'آیکون جدید سفید، ساده و حرفه‌ای',
      'دکمه «به‌روزرسانی» در بالای اپ، وقتی نسخه جدید منتشر شده باشد',
      'بعد از هر به‌روزرسانی، قابلیت‌های جدید همان نسخه نمایش داده می‌شود',
      'تنظیمات ← نسخه اپ: نمایش نسخه و بررسی به‌روزرسانی',
    ],
  },
  {
    id: 5,
    date: '۳ مهر ۱۴۰۵',
    items: [
      'لوگو، آیکون و رنگ‌بندی جدید آبی',
      'ورود با گوگل در اپ اندروید درست شد',
      'صفحه شروع اپ: لوگو در وسط صفحه، بدون کشیدگی',
      'دکمه «اپ اندروید» در بالای صفحه با توضیح',
    ],
  },
  {
    id: 4,
    date: '۳ مهر ۱۴۰۵',
    items: [
      'حساب کاربری آنلاین: با همان ایمیل یا گوگل در سایت، اپ اندروید و هر دستگاهی وارد شوید و همه پرامپت‌هایتان را ببینید',
      'همگام‌سازی خودکار: هر پرامپتی که بسازید، پین کنید، آرشیو یا حذف کنید، روی همه دستگاه‌ها اعمال می‌شود',
      'اگر قبلاً حساب داشتید، یک بار دوباره وارد شوید؛ حساب و پرامپت‌های قبلی خودکار منتقل می‌شوند',
      'لوگو و آیکون جدید پرامپت‌ساز',
    ],
  },
  {
    id: 3,
    date: '۳ مهر ۱۴۰۵',
    items: [
      'ورود با گوگل در اپ اندروید (از نسخه جدید اپ)',
      'گفتن با میکروفون بازنویسی شد: یک بار بزنید و صحبت کنید، دوباره بزنید تا متن مرتب و روان (فارسی یا انگلیسی، همان زبانی که گفتید) نوشته شود؛ در سایت و اپ',
      'خواندن پرامپت با صدا در اپ اندروید',
      'پیام نصب اپ برای کسانی که اپ را نصب کرده‌اند دیگر نمایش داده نمی‌شود',
      'اطلاع‌رسانی نسخه جدید اپ اندروید با دکمه نصب',
      'نمایش تازه‌های هر نسخه، مثل همین پیام',
    ],
  },
  {
    id: 2,
    date: '۳ مهر ۱۴۰۵',
    items: [
      'پین کردن پرامپت‌ها و بخش «پین‌شده‌ها» در منو',
      'در منوی بسته: دکمه‌های «پین‌شده‌ها» و «اخیر» (۱۰ پرامپت آخر)',
      'چیدمان مرتب پرامپت‌ها: هر بخش و هر مورد شماره‌دار در خط جدا',
      'رعایت نگارش فارسی: نیم‌فاصله، ویرگول و علامت سؤال فارسی، اعداد فارسی',
    ],
  },
];

const SEEN_KEY = 'pc.whatsNewSeen';
const UPDATE_KEY = 'pc.appUpdateSnooze';
const LATEST = CHANGELOG[0].id;

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function write(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* storage unavailable */ }
}

function listHtml(entries) {
  return entries.map((e) => `
    <section class="changelog-entry">
      <h3>${esc(e.date)}</h3>
      <ul>${e.items.map((t) => `<li>${icon('check')}<span>${esc(t)}</span></li>`).join('')}</ul>
    </section>`).join('');
}

/** Shows the full changelog (from the help page and the account menu). */
export function showChangelog() {
  write(SEEN_KEY, LATEST);
  return modal({
    title: 'تازه‌های پرامپت‌ساز',
    size: 'modal-news',
    body: `<div class="changelog">${listHtml(CHANGELOG)}</div>`,
    actions: [{ label: 'متوجه شدم', class: 'btn-primary', value: true }],
  });
}

/**
 * After an update, shows what changed since the user's last visit, once. First-time visitors (not signed in,
 * nothing seen yet) are not interrupted; their "seen" mark is set silently.
 */
export async function maybeShowWhatsNew({ returning }) {
  const seen = Number(read(SEEN_KEY) || 0);
  if (seen >= LATEST) return;
  if (!seen && !returning) { write(SEEN_KEY, LATEST); return; }
  const fresh = CHANGELOG.filter((e) => e.id > seen).slice(0, 3);
  write(SEEN_KEY, LATEST);
  await modal({
    title: 'تازه‌های این نسخه',
    size: 'modal-news',
    body: `<div class="changelog"><p class="muted">پرامپت‌ساز به‌روز شد. قابلیت‌های جدید:</p>${listHtml(fresh)}</div>`,
    actions: [{ label: 'عالی، متوجه شدم', class: 'btn-primary', value: true }],
  });
}

/** Version code of the installed Android app, from its user agent ("PromptSazApp/12"); 0 for early builds. */
export function installedAppVersion() {
  const m = navigator.userAgent.match(/PromptSazApp(?:\/(\d+))?/);
  return m ? Number(m[1] || 0) : null;
}

const APP_SEEN_KEY = 'pc.appVersionSeen';
let pending = null; // { code, name, url } when a newer APK is published

/** The newer APK waiting to be installed, if any (drives the «به‌روزرسانی» button in the app's top bar). */
export function pendingUpdate() {
  return pending;
}

/** Looks up the latest published APK (assets/android-version.json, written by the build workflow). */
export async function fetchLatestApp() {
  const res = await fetch(`assets/android-version.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('اطلاعات نسخه‌ها در دسترس نیست.');
  const latest = await res.json();
  const code = Number(latest?.versionCode || 0);
  return {
    code,
    name: String(latest?.versionName || code),
    url: typeof latest?.apkUrl === 'string' && latest.apkUrl.startsWith('https://') ? latest.apkUrl : ANDROID_APK_URL,
  };
}

/** The update dialog: what's new, and «دریافت و نصب». Resolves true when the download was started. */
export async function offerUpdate(update = pending) {
  if (!update) return false;
  const ok = await modal({
    title: 'نسخه جدید اپ آماده است',
    size: 'modal-news',
    body: `
      <div class="changelog">
        <div class="update-hero">${icon('download')}<div><strong>نسخه ${esc(update.name)}</strong>
          <p class="muted small">فایل جدید را دانلود و نصب کنید؛ روی همین نسخه نصب می‌شود و حساب و پرامپت‌های شما حفظ می‌شود.</p></div></div>
        ${listHtml(CHANGELOG.slice(0, 2))}
      </div>`,
    actions: [
      { label: 'بعداً', class: 'btn-ghost', value: false },
      { label: 'دریافت و نصب', class: 'btn-primary', value: true },
    ],
  });
  if (ok) {
    // A link to another host opens in the phone's browser, which downloads the APK and offers to install it.
    location.href = update.url;
  } else {
    write(UPDATE_KEY, `${update.code}:${Date.now()}`);
  }
  return ok;
}

/**
 * In the Android app: checks for a newer APK. When there is one, the top bar shows «به‌روزرسانی» (event
 * `pc:app-update`) and the dialog opens, unless «بعداً» was chosen for this version in the last day.
 * `manual` (from Settings) always opens the dialog and reports «up to date». Returns the update or null.
 */
export async function checkAppUpdate({ manual = false } = {}) {
  const installed = installedAppVersion();
  if (installed === null) return null;
  let latest;
  try {
    latest = await fetchLatestApp();
  } catch (err) {
    if (manual) throw err;
    return null;
  }
  pending = latest.code > installed ? latest : null;
  window.dispatchEvent(new CustomEvent('pc:app-update', { detail: pending }));
  if (!pending) return null;
  const snooze = String(read(UPDATE_KEY) || '').split(':');
  const snoozed = Number(snooze[0]) === pending.code && Date.now() - Number(snooze[1] || 0) < 86400000;
  if (manual || !snoozed) await offerUpdate(pending);
  return pending;
}

/**
 * In the Android app, after an update (or on the first run after installing): shows what is new in the
 * installed version, once per version. Returns true when it was shown.
 */
export async function maybeShowAppWhatsNew() {
  const installed = installedAppVersion();
  if (!installed) return false;
  const last = Number(read(APP_SEEN_KEY) || 0);
  if (last >= installed) return false;
  // Installs from before this marker existed already stored the website's "seen" mark: that is an update too.
  const updated = Boolean(last || read(SEEN_KEY));
  write(APP_SEEN_KEY, installed);
  write(SEEN_KEY, LATEST); // the same list: no second popup for the website changes
  await modal({
    title: updated ? 'اپ به‌روز شد' : 'به پرامپت‌ساز خوش آمدید',
    size: 'modal-news',
    body: `<div class="changelog">
      <div class="update-hero">${icon('sparkles')}<div><strong>نسخه ۱٫۰٫${esc(String(installed).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]))}</strong>
        <p class="muted small">${updated ? 'قابلیت‌های جدید این نسخه:' : 'آخرین قابلیت‌های پرامپت‌ساز:'}</p></div></div>
      ${listHtml(CHANGELOG.slice(0, 2))}</div>`,
    actions: [{ label: 'عالی، متوجه شدم', class: 'btn-primary', value: true }],
  });
  return true;
}
