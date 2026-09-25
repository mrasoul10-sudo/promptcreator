// "What's new" popup after a release, and the Android app's "new version available" prompt.
// Add a CHANGELOG entry (newest first, id + 1) for every user-visible release.

import { esc, icon, modal } from './ui.js?v=202609251442';
import { ANDROID_APK_URL } from './config.js?v=202609251442';

export const CHANGELOG = [
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

/**
 * In the Android app: if a newer APK has been published (assets/android-version.json, written by the
 * build workflow), offers to download it. "Later" snoozes the prompt for a day.
 */
export async function checkAppUpdate() {
  const installed = installedAppVersion();
  if (installed === null) return;
  let latest;
  try {
    const res = await fetch(`assets/android-version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    latest = await res.json();
  } catch {
    return;
  }
  const code = Number(latest?.versionCode || 0);
  if (!code || code <= installed) return;
  const snooze = String(read(UPDATE_KEY) || '').split(':');
  if (Number(snooze[0]) === code && Date.now() - Number(snooze[1] || 0) < 86400000) return;
  const url = typeof latest.apkUrl === 'string' && latest.apkUrl.startsWith('https://') ? latest.apkUrl : ANDROID_APK_URL;
  const notes = CHANGELOG.slice(0, 2);
  const ok = await modal({
    title: 'نسخه جدید اپ آماده است',
    size: 'modal-news',
    body: `
      <div class="changelog">
        <div class="update-hero">${icon('download')}<div><strong>نسخه ${esc(String(latest.versionName || code))}</strong>
          <p class="muted small">فایل جدید را دانلود و نصب کنید؛ روی همین نسخه نصب می‌شود و اطلاعات شما حفظ می‌شود.</p></div></div>
        ${listHtml(notes)}
      </div>`,
    actions: [
      { label: 'بعداً', class: 'btn-ghost', value: false },
      { label: 'دریافت و نصب', class: 'btn-primary', value: true },
    ],
  });
  if (ok) {
    // A link to another host opens in the phone's browser, which downloads the APK and offers to install it.
    location.href = url;
  } else {
    write(UPDATE_KEY, `${code}:${Date.now()}`);
  }
}
