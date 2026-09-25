// Prompt Creator (پرامپت‌ساز) — single-page app shell, hash router and views. Layout follows a chat-app pattern:
// a sidebar with recent prompts, a top bar, and a composer-first home page.

import * as auth from './auth.js?v=202609251442';
import * as prompts from './prompts.js?v=202609251442';
import * as engine from './engine.js?v=202609251442';
import { findInappropriate, INAPPROPRIATE_MESSAGE } from './moderation.js?v=202609251442';
import { ANDROID_APK_URL, ANDROID_RELEASES_URL } from './config.js?v=202609251442';
import * as voice from './voice.js?v=202609251442';
import * as google from './google.js?v=202609251442';
import * as updates from './updates.js?v=202609251442';
import * as sync from './sync.js?v=202609251442';
import * as api from './api.js?v=202609251442';
import {
  $, $$, esc, icon, toast, modal, confirmDialog, copyText, formatDate, relativeTime, num,
  highlight, truncate, avatarHtml, paintAvatars, download, logoMark, enableTooltips,
} from './ui.js?v=202609251442';

const APP_NAME = 'پرامپت‌ساز';
const view = $('#view');
const DRAFT_KEY = 'pc.draft';
const THEME_KEY = 'pc.theme';
const SIDEBAR_KEY = 'pc.sidebar';
const APP_BANNER_KEY = 'pc.appBanner';

const ANDROID_APP_ID = 'io.github.mrasoul10sudo.promptsaz';
let appInstalledCheck = null;

/**
 * True when the Android app is installed on this phone (Chrome's getInstalledRelatedApps: the web manifest lists
 * the app in related_applications and the app declares this site in its asset_statements; see android.yml).
 */
function androidAppInstalled() {
  appInstalledCheck ||= (async () => {
    try {
      const apps = await navigator.getInstalledRelatedApps?.();
      return Boolean(apps?.some((a) => a.id === ANDROID_APP_ID));
    } catch {
      return false;
    }
  })();
  return appInstalledCheck;
}

/** The "get the Android app" banner: only in Android browsers (not in the app), until dismissed (hidden 30 days). */
function showAppBanner() {
  if (google.inAndroidApp() || !/Android/i.test(navigator.userAgent)) return false;
  try {
    const dismissed = Number(localStorage.getItem(APP_BANNER_KEY) || 0);
    return Date.now() - dismissed > 30 * 86400000;
  } catch {
    return true;
  }
}

// Browsers that support installing the site as an app (PWA) fire this; the app page offers it as a button.
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $('#pwa-install')?.removeAttribute('hidden');
});
const mobileQuery = matchMedia('(max-width: 860px)');

// Studio state survives navigation within the session.
const studio = {
  result: null, // saved prompt record shown in the thread
  pending: null, // { source } while a generation runs
  busy: false,
  controller: null,
  startedAt: 0,
  timer: null,
};

const EXAMPLES = [
  { type: 'image', text: 'یک لوگوی مینیمال برای کافه با رنگ‌های گرم' },
  { type: 'coding', text: 'یک صفحه ورود ساده با React و اعتبارسنجی فرم می‌خواهم' },
  { type: 'writing', text: 'یک متن معرفی کوتاه برای صفحه اینستاگرام فروشگاه لباس' },
  { type: 'video', text: 'ویدیوی کوتاه از طلوع آفتاب روی کوه‌های البرز با حرکت آرام دوربین' },
];

// ---------- Theme ----------

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
}

function currentTheme() {
  const explicit = document.documentElement.dataset.theme;
  if (explicit) return explicit;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
}

try { applyTheme(localStorage.getItem(THEME_KEY)); } catch { /* ignore */ }

// ---------- Router ----------

// Every page except the studio needs an account; the studio (home) is open to guests.
const ROUTES = {
  '/studio': { render: renderStudio, title: 'پرامپت جدید', auth: false },
  '/history': { render: renderHistory, title: 'جستجوی پرامپت‌ها', auth: true },
  '/archive': { render: renderArchive, title: 'آرشیو', auth: true },
  '/profile': { render: renderProfile, title: 'حساب کاربری', auth: true },
  '/settings': { render: renderSettings, title: 'تنظیمات', auth: true },
  '/help': { render: renderHelp, title: 'راهنما', auth: false },
  '/rules': { render: renderRules, title: 'قوانین', auth: false },
  '/app': { render: renderApp, title: 'دریافت اپ', auth: false },
  '/admin': { render: renderAdmin, title: 'پنل مدیریت', auth: true, admin: true },
};

const AUTH_REASONS = {
  '/history': 'برای دیدن پرامپت‌های قبلی‌تان وارد شوید.',
  '/archive': 'برای دسترسی به آرشیو وارد شوید.',
  '/profile': 'برای مدیریت حساب کاربری وارد شوید.',
  '/settings': 'برای تنظیمات وارد شوید.',
};

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/studio';
  const [path, query = ''] = raw.split('?');
  return { path, params: new URLSearchParams(query) };
}

export function navigate(path) {
  if (location.hash === `#${path}`) route();
  else location.hash = path;
}

async function route() {
  const { path, params } = parseHash();
  const user = auth.currentUser();
  let target = ROUTES[path] ? path : '/studio';
  const blocked = ROUTES[target].auth && !user;
  if (blocked || (ROUTES[target].admin && user && !auth.isAdmin())) target = '/studio';
  if (target !== path) history.replaceState(null, '', `#${target}`);
  document.title = `${ROUTES[target].title} · ${APP_NAME}`;
  document.body.dataset.page = target.slice(1);
  closeDrawer();
  voice.stopDictation();
  voice.stopSpeaking();
  renderTopbar();
  renderSidebar();
  view.classList.remove('view-enter');
  void view.offsetWidth; // restart the enter animation
  view.classList.add('view-enter');
  try {
    await ROUTES[target].render(params);
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="empty">${icon('info', 'icon-lg')}<p>${esc(err.message || 'خطا در نمایش صفحه')}</p></div>`;
  }
  if (target !== '/studio') { $('.main')?.scrollTo({ top: 0 }); window.scrollTo({ top: 0 }); }
  if (blocked && ROUTES[path]) {
    if (await openAuthModal({ reason: AUTH_REASONS[path] })) navigate(path);
  }
}

window.addEventListener('hashchange', route);

/** Keeps query parameters in the URL (bookmarkable) without triggering a re-route. */
function syncQuery(values) {
  const { path } = parseHash();
  const params = new URLSearchParams();
  Object.entries(values).forEach(([k, v]) => { if (v) params.set(k, v); });
  const qs = params.toString();
  history.replaceState(null, '', `#${path}${qs ? `?${qs}` : ''}`);
}

// ---------- Sidebar & top bar ----------

function toggleSidebar() {
  if (mobileQuery.matches) {
    document.body.classList.toggle('drawer-open');
    return;
  }
  closeFlyout();
  const closed = document.body.classList.toggle('sidebar-closed');
  try { localStorage.setItem(SIDEBAR_KEY, closed ? 'closed' : 'open'); } catch { /* ignore */ }
}

function closeDrawer() {
  document.body.classList.remove('drawer-open');
}

try { if (localStorage.getItem(SIDEBAR_KEY) === 'closed') document.body.classList.add('sidebar-closed'); } catch { /* ignore */ }
$('#scrim').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

function newPrompt() {
  if (studio.busy) studio.controller?.abort();
  studio.result = null;
  saveDraft(null);
  if (parseHash().path === '/studio' && !parseHash().params.get('p')) route();
  else navigate('/studio');
}

function groupLabel(ts) {
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(new Date()) - start(new Date(ts))) / 86400000);
  if (days === 0) return 'امروز';
  if (days === 1) return 'دیروز';
  if (days < 7) return '۷ روز گذشته';
  if (days < 30) return '۳۰ روز گذشته';
  return 'قدیمی‌تر';
}

async function renderSidebar() {
  const user = auth.currentUser();
  const sidebar = $('#sidebar');
  const active = parseHash().path;
  closeFlyout();
  sidebar.innerHTML = `
    <div class="sb-head">
      <a class="brand" href="#/studio" aria-label="${APP_NAME}">
        ${logoMark('brand-mark')}<span class="brand-name">${APP_NAME}</span>
      </a>
      <button class="icon-btn sb-toggle" data-toggle-sidebar aria-label="باز و بسته کردن منو" data-tip="باز کردن منو">${logoMark('toggle-logo')}${icon('sidebar')}</button>
    </div>
    <div class="sb-scroll">
    <nav class="sb-nav" aria-label="منوی اصلی">
      <button class="sb-item" id="sb-new" data-tip="پرامپت جدید">${icon('edit')}<span>پرامپت جدید</span></button>
      <a class="sb-item ${active === '/history' ? 'active' : ''}" href="#/history" data-tip="جستجوی پرامپت‌ها">${icon('search')}<span>جستجوی پرامپت‌ها</span></a>
      <a class="sb-item ${active === '/archive' ? 'active' : ''}" href="#/archive" data-tip="آرشیو">${icon('archive')}<span>آرشیو</span></a>
      ${user ? `
        <button class="sb-item sb-rail-only" data-flyout="pinned" aria-haspopup="menu" aria-expanded="false" data-tip="پین‌شده‌ها">${icon('pin')}<span>پین‌شده‌ها</span></button>
        <button class="sb-item sb-rail-only" data-flyout="recent" aria-haspopup="menu" aria-expanded="false" data-tip="اخیر">${icon('clock')}<span>اخیر</span></button>` : ''}
    </nav>
    <div class="sb-recent" id="sb-recent">
      ${user ? '' : `
        <div class="sb-guest">
          <strong>پرامپت‌هایتان را ذخیره کنید</strong>
          <p>وارد شوید تا تاریخچه و آرشیو پرامپت‌هایتان همیشه در دسترس باشد.</p>
          <button class="btn btn-primary btn-block btn-sm" data-login="login">ورود</button>
        </div>`}
    </div>
    <nav class="sb-nav sb-secondary" aria-label="راهنما">
      ${auth.isAdmin() ? `<a class="sb-item ${active === '/admin' ? 'active' : ''}" href="#/admin" data-tip="پنل مدیریت">${icon('shield')}<span>پنل مدیریت</span></a>` : ''}
      <a class="sb-item ${active === '/help' ? 'active' : ''}" href="#/help" data-tip="راهنما">${icon('help')}<span>راهنما</span></a>
      <a class="sb-item ${active === '/rules' ? 'active' : ''}" href="#/rules" data-tip="قوانین">${icon('shield')}<span>قوانین</span></a>
    </nav>
    </div>
    <div class="sb-foot">
      ${user ? `
        <button class="sb-user" id="user-menu-btn" aria-haspopup="menu" aria-expanded="false" data-tip="${esc(user.name)}">
          ${avatarHtml(user, 'sm')}
          <span class="user-meta"><strong>${esc(user.name)}</strong><small>${esc(user.email)}</small></span>
        </button>` : `
        <button class="sb-item" data-theme-toggle data-tip="${currentTheme() === 'dark' ? 'تم روشن' : 'تم تیره'}">${icon(currentTheme() === 'dark' ? 'sun' : 'moon')}<span>${currentTheme() === 'dark' ? 'تم روشن' : 'تم تیره'}</span></button>`}
    </div>`;
  paintAvatars(sidebar);
  $('#sb-new').addEventListener('click', newPrompt);
  $$('[data-toggle-sidebar]', sidebar).forEach((b) => b.addEventListener('click', toggleSidebar));
  $$('[data-login]', sidebar).forEach((b) => b.addEventListener('click', () => openAuthModal({ mode: b.dataset.login })));
  $$('[data-theme-toggle]', sidebar).forEach((b) => b.addEventListener('click', () => { toggleTheme(); renderSidebar(); renderTopbar(); }));
  $('#user-menu-btn')?.addEventListener('click', (e) => openUserMenu(e.currentTarget));
  $$('[data-flyout]', sidebar).forEach((b) => b.addEventListener('click', () => openFlyout(b)));
  $('#sb-recent').addEventListener('click', (e) => {
    const pinBtn = e.target.closest('[data-pin]');
    if (!pinBtn) return;
    e.preventDefault();
    togglePin(pinBtn.dataset.pin);
  });
  if (user) fillRecent(user);
}

function sbLink(r, currentId) {
  return `
    <div class="sb-row">
      <a class="sb-link ${r.id === currentId ? 'active' : ''}" href="#/studio?p=${encodeURIComponent(r.id)}" title="${esc(r.title || r.source)}">
        <span dir="auto">${esc(truncate(r.title || r.source, 42))}</span>
        ${r.archived ? icon('archive', 'sb-flag') : ''}
      </a>
      <button class="sb-pin ${r.pinned ? 'on' : ''}" data-pin="${esc(r.id)}" aria-label="${r.pinned ? 'برداشتن پین' : 'پین کردن'}" title="${r.pinned ? 'برداشتن پین' : 'پین کردن'}">${icon('pin')}</button>
    </div>`;
}

/** Pins or unpins a prompt, then refreshes the sidebar and the open thread. */
async function togglePin(id) {
  const user = auth.currentUser();
  if (!user) return;
  try {
    const row = await prompts.get(user.id, id);
    const saved = await prompts.setPinned(user.id, id, !row.pinned);
    toast(saved.pinned ? 'پرامپت پین شد' : 'پین برداشته شد', 'success');
    if (studio.result?.id === id) {
      studio.result = { ...studio.result, pinned: saved.pinned, pinnedAt: saved.pinnedAt };
      if ($('#thread .msg-bot')) showThread(studio.result);
    }
    fillRecent(user);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------- Rail flyouts (collapsed sidebar): pinned prompts and the 10 most recent, beside the button ----------

let flyout = null;

function closeFlyout() {
  if (!flyout) return;
  flyout.cleanup();
  flyout = null;
}

async function openFlyout(btn) {
  const kind = btn.dataset.flyout;
  const same = flyout?.kind === kind;
  closeFlyout();
  if (same) return;
  const user = auth.currentUser();
  if (!user) return;
  const rows = await prompts.listForUser(user.id);
  const items = kind === 'pinned' ? prompts.pinnedOf(rows) : rows.slice(0, 10);
  const menu = document.createElement('div');
  menu.className = 'sb-flyout';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `
    <div class="sb-flyout-head">${kind === 'pinned' ? 'پین‌شده‌ها' : 'اخیر'}</div>
    ${items.length ? items.map((r) => `
      <a role="menuitem" href="#/studio?p=${encodeURIComponent(r.id)}" title="${esc(r.title || r.source)}">
        <span dir="auto">${esc(truncate(r.title || r.source, 48))}</span>
        ${r.pinned && kind !== 'pinned' ? icon('pin', 'sb-flag') : ''}
      </a>`).join('') : `<p class="sb-flyout-empty">${kind === 'pinned'
      ? 'هنوز پرامپتی پین نکرده‌اید. در منوی باز، روی آیکون سنجاق کنار هر پرامپت بزنید.'
      : 'هنوز پرامپتی نساخته‌اید.'}</p>`}`;
  document.body.appendChild(menu);
  // Place it beside the button, toward the page content (left of the rail in RTL), clamped inside the viewport.
  const r = btn.getBoundingClientRect();
  const rail = btn.closest('.sidebar').getBoundingClientRect();
  const m = menu.getBoundingClientRect();
  const gap = 8;
  const toLeft = r.left + r.width / 2 > innerWidth / 2;
  let x = toLeft ? rail.left - gap - m.width : rail.right + gap;
  let y = r.top - 6;
  x = Math.min(Math.max(8, x), innerWidth - m.width - 8);
  y = Math.min(Math.max(8, y), innerHeight - m.height - 8);
  menu.style.left = `${Math.round(x)}px`;
  menu.style.top = `${Math.round(y)}px`;
  btn.setAttribute('aria-expanded', 'true');
  const outside = (e) => { if (!menu.contains(e.target) && !btn.contains(e.target)) closeFlyout(); };
  const onKey = (e) => { if (e.key === 'Escape') { closeFlyout(); btn.focus(); } };
  const onResize = () => closeFlyout();
  document.addEventListener('mousedown', outside);
  document.addEventListener('keydown', onKey);
  addEventListener('resize', onResize);
  addEventListener('hashchange', onResize);
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) closeFlyout(); });
  flyout = {
    kind,
    cleanup() {
      menu.remove();
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', onKey);
      removeEventListener('resize', onResize);
      removeEventListener('hashchange', onResize);
    },
  };
}

let recentToken = 0;

async function fillRecent(user) {
  // The sidebar can re-render while the list loads; only the latest call may write, into the live element.
  const token = ++recentToken;
  const all = await prompts.listForUser(user.id);
  const rows = all.filter((r, i) => i < 40 || r.pinned);
  const box = $('#sb-recent');
  if (token !== recentToken || !box || auth.currentUser()?.id !== user.id) return;
  if (!rows.length) {
    box.innerHTML = '<p class="sb-empty">پرامپت‌هایی که می‌سازید اینجا نمایش داده می‌شوند.</p>';
    return;
  }
  const { path, params } = parseHash();
  const currentId = path === '/studio' ? params.get('p') || studio.result?.id : null;
  const pinned = prompts.pinnedOf(rows);
  const groups = new Map();
  for (const r of rows.filter((x) => !x.pinned)) {
    const label = groupLabel(r.createdAt);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(r);
  }
  const sections = pinned.length ? [['پین‌شده‌ها', pinned], ...groups.entries()] : [...groups.entries()];
  box.innerHTML = sections.map(([label, items], i) => `
    <div class="sb-group ${pinned.length && i === 0 ? 'sb-pinned' : ''}">
      <h3>${esc(label)}</h3>
      ${items.map((r) => sbLink(r, currentId)).join('')}
    </div>`).join('');
}

function openUserMenu(anchor) {
  const existing = $('.user-menu');
  if (existing) { existing.remove(); anchor.setAttribute('aria-expanded', 'false'); return; }
  const user = auth.currentUser();
  const menu = document.createElement('div');
  menu.className = 'user-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `
    <div class="user-menu-head"><span dir="ltr">${esc(user.email)}</span></div>
    <a role="menuitem" href="#/profile">${icon('user')}<span>حساب کاربری</span></a>
    <a role="menuitem" href="#/settings">${icon('settings')}<span>تنظیمات</span></a>
    ${auth.isAdmin() ? `<a role="menuitem" href="#/admin">${icon('shield')}<span>پنل مدیریت</span></a>` : ''}
    ${google.inAndroidApp() ? '' : `<a role="menuitem" href="#/app">${icon('phone')}<span>دریافت اپ اندروید</span></a>`}
    <button role="menuitem" data-act="news">${icon('sparkles')}<span>تازه‌ها</span></button>
    <button role="menuitem" data-act="theme">${icon(currentTheme() === 'dark' ? 'sun' : 'moon')}<span>${currentTheme() === 'dark' ? 'تم روشن' : 'تم تیره'}</span></button>
    <hr>
    <button role="menuitem" data-act="logout">${icon('logout')}<span>خروج</span></button>`;
  anchor.after(menu);
  anchor.setAttribute('aria-expanded', 'true');
  const close = () => { menu.remove(); anchor.setAttribute('aria-expanded', 'false'); document.removeEventListener('mousedown', outside); };
  const outside = (e) => { if (!menu.contains(e.target) && !anchor.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener('mousedown', outside));
  menu.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'theme') { toggleTheme(); close(); renderSidebar(); renderTopbar(); return; }
    if (act === 'logout') { close(); logout(); return; }
    if (act === 'news') { close(); updates.showChangelog(); return; }
    if (e.target.closest('a')) close();
  });
}

function logout() {
  auth.logout();
  studio.result = null;
  toast('از حساب خارج شدید');
  navigate('/studio');
}

function renderTopbar() {
  const user = auth.currentUser();
  const bar = $('#topbar');
  bar.innerHTML = `
    <div class="tb-start">
      <button class="icon-btn tb-menu" data-toggle-sidebar aria-label="باز کردن منو" title="منو">${icon('sidebar')}</button>
      <a class="tb-title" href="#/studio">${APP_NAME}</a>
    </div>
    <div class="tb-end">
      ${user ? '' : `
        <button class="btn btn-primary btn-pill btn-sm" data-login="login">ورود</button>
        <button class="btn btn-outline btn-pill btn-sm tb-signup" data-login="register">ثبت‌نام رایگان</button>`}
      ${google.inAndroidApp() ? '' : `<a class="icon-btn tb-app" href="#/app" aria-label="دریافت اپ اندروید" title="دریافت اپ اندروید">${icon('phone')}</a>`}
      <button class="icon-btn tb-theme" aria-label="تغییر تم روشن و تیره" title="${currentTheme() === 'dark' ? 'تم روشن' : 'تم تیره'}">${icon(currentTheme() === 'dark' ? 'sun' : 'moon')}</button>
      <button class="icon-btn tb-new" aria-label="پرامپت جدید" title="پرامپت جدید">${icon('edit')}</button>
    </div>`;
  $$('[data-toggle-sidebar]', bar).forEach((b) => b.addEventListener('click', toggleSidebar));
  $$('[data-login]', bar).forEach((b) => b.addEventListener('click', () => openAuthModal({ mode: b.dataset.login })));
  $('.tb-new', bar).addEventListener('click', newPrompt);
  $('.tb-theme', bar).addEventListener('click', () => { toggleTheme(); renderTopbar(); renderSidebar(); });
  // Not offered on a phone where the app is already installed.
  if ($('.tb-app', bar)) androidAppInstalled().then((installed) => { if (installed) $('.tb-app', bar)?.remove(); });
}

// ---------- Auth dialog ----------

let authOpen = null;

/** Shows a one-time recovery code; the user needs it if they forget their password. */
function showRecoveryCode(code, { fresh = true } = {}) {
  return modal({
    title: 'کد بازیابی رمز عبور',
    size: 'modal-sm',
    body: `
      <p class="confirm-text">${fresh ? 'حساب شما ساخته شد. ' : ''}اگر رمز عبور را فراموش کنید، فقط با این کد می‌توانید رمز جدید بگذارید. آن را در جای امنی نگه دارید؛ دوباره نمایش داده نمی‌شود.</p>
      <div class="recovery-code" dir="ltr">${esc(code)}</div>
      <div class="form-actions start">
        <button type="button" class="btn btn-soft btn-sm" id="copy-code">${icon('copy')} کپی</button>
        <button type="button" class="btn btn-ghost btn-sm" id="save-code">${icon('download')} ذخیره در فایل</button>
      </div>`,
    actions: [{ label: 'ذخیره کردم', class: 'btn-primary', value: true }],
    onMount: (root) => {
      $('#copy-code', root).addEventListener('click', (e) => copyText(code, e.currentTarget));
      $('#save-code', root).addEventListener('click', () => download('promptcreator-recovery-code.txt', `${APP_NAME}\n${auth.currentUser()?.email || ''}\nکد بازیابی: ${code}\n`, 'text/plain'));
    },
  });
}

/**
 * Sign-in / sign-up dialog in steps: email first, then password (existing account) or name + password (new account).
 * Resolves true once the user is signed in, false if dismissed. The current page is re-rendered after sign-in.
 */
function openAuthModal({ mode = 'login', reason = '' } = {}) {
  if (authOpen) return authOpen;
  let signedIn = false;
  let recoveryCode = null;
  authOpen = modal({
    title: mode === 'register' ? 'ساخت حساب رایگان' : 'ورود یا ثبت‌نام',
    size: 'modal-auth',
    body: `
      <div class="auth-dialog">
        <p class="auth-sub">${esc(reason || 'پرامپت‌های حرفه‌ای بسازید و همه را در تاریخچه و آرشیو خودتان نگه دارید.')}</p>
        ${google.enabled() ? `
          <div class="google-slot" id="google-slot"><div class="skeleton google-skeleton"></div></div>
          <div class="divider"><span>یا</span></div>` : ''}
        <form id="auth-form" novalidate>
          <div class="auth-email-chip" data-step="password register" hidden>
            <span dir="ltr" id="auth-email-text"></span>
            <button type="button" class="link-btn" id="auth-edit-email">ویرایش</button>
          </div>
          <label class="field float" data-step="email forgot">
            <input name="email" type="email" dir="ltr" autocomplete="email" placeholder=" " required>
            <span>نشانی ایمیل</span>
          </label>
          <label class="field float" data-step="register">
            <input name="name" autocomplete="name" placeholder=" " minlength="2">
            <span>نام شما</span>
          </label>
          <label class="field float" data-step="forgot">
            <input name="code" dir="ltr" autocomplete="off" spellcheck="false" placeholder=" ">
            <span>کد بازیابی</span>
          </label>
          <label class="field float" data-step="password register forgot">
            <input name="password" type="password" dir="ltr" autocomplete="current-password" placeholder=" " minlength="6">
            <span data-label="password">رمز عبور</span>
          </label>
          <div class="auth-row" data-step="password register forgot">
            <label class="check"><input type="checkbox" name="remember" checked><span>مرا به خاطر بسپار</span></label>
            <button type="button" class="link-btn" data-step="password" id="forgot-link">فراموشی رمز</button>
          </div>
          <p class="auth-hint" data-step="forgot">${icon('info')} <span>کد بازیابی هنگام ثبت‌نام به شما داده شده است.${google.enabled() ? ' اگر ایمیل حسابتان ایمیل گوگل است، با «ادامه با گوگل» وارد شوید و از حساب کاربری رمز جدید بگذارید.' : ''}</span></p>
          <p class="form-error" role="alert" hidden></p>
          <button class="btn btn-primary btn-block btn-lg btn-pill" type="submit">ادامه</button>
        </form>
        <p class="auth-legal">با ادامه، <a href="terms.html" target="_blank" rel="noopener">شرایط استفاده</a> و <a href="privacy.html" target="_blank" rel="noopener">حریم خصوصی</a> را می‌پذیرید. حساب و پرامپت‌ها در حساب شما ذخیره می‌شوند و در سایت و اپ یکسان‌اند.</p>
      </div>`,
    onMount: (root, close) => {
      const form = $('#auth-form', root);
      const errorBox = $('.form-error', form);
      const submit = $('button[type=submit]', form);
      const title = $('#modal-title', root);
      const input = (name) => $(`input[name=${name}]`, form);
      let step = 'email';

      const showError = (message) => {
        errorBox.textContent = message;
        errorBox.hidden = false;
        form.classList.remove('shake');
        void form.offsetWidth;
        form.classList.add('shake');
      };
      const done = (user, isNew) => {
        signedIn = true;
        toast(isNew ? 'حساب شما ساخته شد' : `خوش آمدید ${user.name}`, 'success');
        close(true);
      };
      const setStep = (next) => {
        step = next;
        $$('[data-step]', form).forEach((el) => { el.hidden = !el.dataset.step.split(' ').includes(next); });
        $('#auth-email-text', form).textContent = input('email').value.trim().toLowerCase();
        input('password').autocomplete = next === 'password' ? 'current-password' : 'new-password';
        $('[data-label=password]', form).textContent = next === 'forgot' ? 'رمز عبور جدید' : next === 'register' ? 'یک رمز عبور بسازید' : 'رمز عبور';
        submit.textContent = { email: 'ادامه', password: 'ورود', register: 'ساخت حساب', forgot: 'تعیین رمز جدید و ورود' }[next];
        title.textContent = { email: 'ورود یا ثبت‌نام', password: 'رمز عبور را وارد کنید', register: 'ساخت حساب رایگان', forgot: 'بازیابی رمز عبور' }[next];
        errorBox.hidden = true;
        const focus = { email: 'email', password: 'password', register: 'name', forgot: 'code' }[next];
        setTimeout(() => input(focus)?.focus(), 30);
      };
      setStep('email');
      $('#auth-edit-email', form).addEventListener('click', () => setStep('email'));
      $('#forgot-link', form).addEventListener('click', () => setStep('forgot'));

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form));
        const payload = { ...data, remember: Boolean(data.remember) };
        errorBox.hidden = true;
        submit.disabled = true;
        submit.classList.add('loading');
        try {
          if (step === 'email') {
            const email = data.email.trim();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('ایمیل معتبر نیست.');
            const account = await auth.lookupAccount(email);
            if (account.exists && !account.hasPassword) throw new Error('این حساب با گوگل ساخته شده است؛ با دکمه «ادامه با گوگل» وارد شوید.');
            setStep(account.exists ? 'password' : 'register');
          } else if (step === 'password') {
            const user = await auth.login(payload);
            // An account from before the server was just created there: it has a new recovery code to show.
            if (user.migrated) recoveryCode = { code: await auth.createRecoveryCode(), fresh: true };
            done(user, false);
          } else if (step === 'register') {
            const user = await auth.register(payload);
            recoveryCode = { code: await auth.createRecoveryCode(), fresh: true };
            done(user, true);
          } else if (step === 'forgot') {
            recoveryCode = { code: await auth.resetPassword(payload), fresh: false };
            toast('رمز عبور جدید ثبت شد', 'success');
            signedIn = true;
            close(true);
          }
        } catch (err) {
          showError(err.message);
        } finally {
          submit.disabled = false;
          submit.classList.remove('loading');
        }
      });

      const slot = $('#google-slot', root);
      if (slot) {
        google.renderButton(slot, async (credential) => {
          try {
            const existed = Boolean(auth.currentUser());
            google.parseCredential(credential); // quick local check (audience, expiry); the server verifies the signature
            const user = await auth.loginWithGoogle(credential, { remember: Boolean(input('remember').checked) });
            if (user.passwordRemoved) toast('برای امنیت حساب، رمز قبلی این ایمیل حذف شد. از «حساب کاربری» می‌توانید رمز جدید بگذارید.', 'info', 9000);
            done(user, !existed && Date.now() - user.createdAt < 5000);
          } catch (err) {
            showError(err.message);
          }
        }, { theme: currentTheme(), onError: (err) => showError(err.message) }).catch((err) => {
          slot.innerHTML = '<p class="muted small"></p>';
          $('p', slot).textContent = err.message;
        });
      }
    },
  }).then(async () => {
    authOpen = null;
    if (signedIn) {
      route();
      if (recoveryCode) await showRecoveryCode(recoveryCode.code, { fresh: recoveryCode.fresh });
    }
    return signedIn;
  });
  return authOpen;
}

// ---------- Studio (composer + thread) ----------

function selectPill(name, options, selected, iconName, label) {
  return `
    <label class="pill-select" title="${esc(label)}">
      ${icon(iconName)}
      <select name="${name}" aria-label="${esc(label)}">
        ${Object.entries(options).map(([value, opt]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${esc(typeof opt === 'string' ? opt : opt.label)}</option>`).join('')}
      </select>
    </label>`;
}

function readDraft() {
  try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); } catch { return null; }
}

function saveDraft(draft) {
  try {
    if (draft) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch { /* ignore */ }
}

function composerHtml(draft) {
  return `
    <form class="composer" id="composer">
      <textarea id="source" name="source" dir="auto" rows="1" maxlength="20000" aria-label="متن شما"
        placeholder="ایده، درخواست یا پرامپت خامتان را بنویسید…">${esc(draft.source)}</textarea>
      <div class="composer-bar">
        <div class="composer-tools">
          ${selectPill('type', engine.TARGETS, draft.type, 'sparkles', 'نوع پرامپت')}
          ${selectPill('lang', engine.LANGS, draft.lang, 'globe', 'زبان خروجی')}
          ${selectPill('detail', engine.DETAILS, draft.detail, 'sliders', 'میزان جزئیات')}
        </div>
        <div class="composer-actions">
          ${voice.canDictate() ? `<button type="button" class="icon-btn mic-btn" id="mic-btn" aria-label="گفتن به‌جای نوشتن" title="گفتن به‌جای نوشتن" aria-pressed="false">${icon('mic')}</button>` : ''}
          <button type="submit" class="send-btn" id="generate-btn" aria-label="ساخت پرامپت" title="ساخت پرامپت" disabled>${icon('arrowUp')}</button>
        </div>
      </div>
    </form>
    <p class="composer-foot"><span>پرامپت‌ساز ممکن است اشتباه کند؛ نتیجه را بررسی کنید.</span><span id="quota-note"></span></p>`;
}

async function renderStudio(params) {
  const s = auth.settings();
  const user = auth.currentUser();
  const requested = params?.get('p');
  if (requested && user) {
    try {
      studio.result = await prompts.get(user.id, requested);
    } catch {
      studio.result = null;
      history.replaceState(null, '', '#/studio');
    }
  } else if (!requested && !studio.busy) {
    studio.result = null;
  }
  const draft = readDraft() || { source: '', type: s.defaultType, lang: s.defaultLang, detail: s.defaultDetail };
  const threadMode = Boolean(studio.result || studio.busy);
  const firstName = user ? String(user.name).split(/\s+/)[0] : '';

  view.innerHTML = `
    ${showAppBanner() ? `
      <div class="app-banner" id="app-banner" hidden>
        ${logoMark('app-banner-logo')}
        <div><strong>اپ اندروید پرامپت‌ساز</strong><span>سریع‌تر و راحت‌تر، مستقیم از صفحه گوشی</span></div>
        <a class="btn btn-primary btn-pill btn-sm" href="#/app">دریافت</a>
        <button class="icon-btn" id="app-banner-close" aria-label="بستن">${icon('x')}</button>
      </div>` : ''}
    <section class="studio ${threadMode ? 'is-thread' : 'is-empty'}">
      ${user && engine.engineFor(s) === 'claude' && !s.apiKey ? `
        <div class="banner">${icon('key')}
          <div><strong>کلید API هنوز تنظیم نشده است.</strong>
          <span>موتور «Claude با کلید شخصی» انتخاب شده است. کلید را در تنظیمات وارد کنید یا به سرویس رایگان برگردید.</span></div>
          <a class="btn btn-sm btn-primary" href="#/settings">تنظیمات</a>
        </div>` : ''}
      <div class="thread" id="thread" aria-live="polite"></div>
      <div class="empty-hero" ${threadMode ? 'hidden' : ''}>
        <h1>${firstName ? `سلام ${esc(firstName)}، امروز چه پرامپتی برات بسازم؟` : 'سلام، امروز چه پرامپتی برات بسازم؟'}</h1>
      </div>
      <div class="composer-wrap">
        ${composerHtml(draft)}
        <div class="suggestions" ${threadMode ? 'hidden' : ''}>
          ${EXAMPLES.map((ex, i) => `<button type="button" class="suggestion" data-example="${i}">${icon(ex.type === 'image' ? 'image' : ex.type === 'coding' ? 'code' : ex.type === 'video' ? 'video' : 'pen')}<span>${esc(ex.text)}</span></button>`).join('')}
        </div>
      </div>
    </section>`;

  // Revealed only once we know the app is not already installed on this phone.
  if ($('#app-banner')) androidAppInstalled().then((installed) => { if (!installed) $('#app-banner')?.removeAttribute('hidden'); });
  $('#app-banner-close')?.addEventListener('click', () => {
    try { localStorage.setItem(APP_BANNER_KEY, String(Date.now())); } catch { /* ignore */ }
    $('#app-banner')?.remove();
  });
  const form = $('#composer');
  const source = $('#source');
  const send = $('#generate-btn');
  const autoGrow = () => {
    source.style.height = 'auto';
    source.style.height = `${Math.min(source.scrollHeight, 280)}px`;
  };
  const sync = () => {
    send.disabled = !studio.busy && !source.value.trim();
    const data = Object.fromEntries(new FormData(form));
    saveDraft({ source: data.source, type: data.type, lang: data.lang, detail: data.detail });
  };

  source.addEventListener('input', () => { autoGrow(); sync(); });
  source.addEventListener('keydown', (e) => {
    // Enter sends, Shift+Enter adds a line (touch keyboards keep Enter for new lines).
    const touch = matchMedia('(pointer: coarse)').matches;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && (!touch || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (source.value.trim() && !studio.busy) form.requestSubmit();
    }
  });
  $$('select', form).forEach((sel) => sel.addEventListener('change', sync));
  $$('[data-example]').forEach((b) => b.addEventListener('click', () => {
    const ex = EXAMPLES[Number(b.dataset.example)];
    source.value = ex.text;
    form.elements.type.value = ex.type;
    autoGrow();
    sync();
    source.focus();
  }));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    voice.stopDictation();
    if (studio.busy) studio.controller?.abort();
    else runGeneration();
  });
  const mic = $('#mic-btn');
  if (mic) {
    // Tap to record, tap again to stop; the recording is then written down as clean text (voice.js).
    const idlePlaceholder = source.placeholder;
    let stopRecording = null;
    const setState = (state) => {
      mic.classList.toggle('listening', state === 'recording');
      mic.classList.toggle('processing', state === 'processing');
      mic.setAttribute('aria-pressed', String(state === 'recording'));
      mic.innerHTML = state === 'processing' ? '<span class="spinner"></span>' : icon(state === 'recording' ? 'stop' : 'mic');
      mic.title = state === 'recording' ? 'پایان و تبدیل به متن' : state === 'processing' ? 'در حال تبدیل گفتار به متن…' : 'گفتن به‌جای نوشتن';
      mic.setAttribute('aria-label', mic.title);
      source.placeholder = state === 'recording' ? 'در حال ضبط… صحبت کنید؛ برای پایان دوباره روی میکروفون بزنید'
        : state === 'processing' ? 'در حال تبدیل گفتار به متن…' : idlePlaceholder;
    };
    mic.addEventListener('click', () => {
      if (mic.classList.contains('processing')) return;
      if (stopRecording) { const stop = stopRecording; stopRecording = null; stop(); return; }
      setState('recording');
      stopRecording = voice.dictate({
        onState: setState,
        onText: (text) => {
          const base = source.value.trim();
          source.value = base ? `${base}\n${text}` : text;
          autoGrow();
          sync();
        },
        onEnd: (error) => {
          stopRecording = null;
          setState('idle');
          if (error) toast(error, 'error', 6000);
          else source.focus();
        },
      });
    });
  }

  requestAnimationFrame(() => { autoGrow(); sync(); });
  if (engine.engineFor(s) === 'free') refreshQuotaNote();
  if (studio.busy) showPending();
  else if (studio.result) showThread(studio.result);
  if (!threadMode && !mobileQuery.matches) source.focus();
}

/** Shows today's remaining free generations under the composer (free engine only). */
async function refreshQuotaNote(known) {
  const q = Number.isFinite(known) ? { remaining: known } : await engine.freeQuota();
  const el = $('#quota-note');
  if (el && q) el.textContent = `${num(q.remaining)} پرامپت رایگان امروز`;
}

function setBusy(busy) {
  studio.busy = busy;
  const btn = $('#generate-btn');
  if (!btn) return;
  btn.classList.toggle('is-stop', busy);
  btn.innerHTML = busy ? icon('stop') : icon('arrowUp');
  btn.setAttribute('aria-label', busy ? 'توقف' : 'ساخت پرامپت');
  btn.title = busy ? 'توقف' : 'ساخت پرامپت';
  btn.disabled = !busy && !$('#source')?.value.trim();
}

function enterThreadMode() {
  $('.studio')?.classList.replace('is-empty', 'is-thread');
  $$('.empty-hero, .suggestions').forEach((el) => { el.hidden = true; });
}

function exitThreadMode() {
  $('.studio')?.classList.replace('is-thread', 'is-empty');
  $$('.empty-hero, .suggestions').forEach((el) => { el.hidden = false; });
}

function userBubble(text) {
  return `<div class="msg msg-user"><div class="bubble" dir="auto"></div></div>`.replace('></div></div>', `>${esc(text)}</div></div>`);
}

function showPending() {
  const thread = $('#thread');
  if (!thread || !studio.pending) return;
  enterThreadMode();
  thread.innerHTML = `
    ${userBubble(studio.pending.source)}
    <div class="msg msg-bot">
      <span class="bot-avatar">${logoMark()}</span>
      <div class="bot-body">
        <div class="thinking"><span class="dots"><i></i><i></i><i></i></span><span>در حال ساخت پرامپت</span><span class="muted" id="elapsed"></span></div>
        <div class="skeleton w-60"></div><div class="skeleton"></div><div class="skeleton w-80"></div>
      </div>
    </div>`;
  setBusy(true);
  const tick = () => {
    const el = $('#elapsed');
    if (el) el.textContent = `· ${num(Math.floor((Date.now() - studio.startedAt) / 1000))} ثانیه`;
  };
  tick();
  clearInterval(studio.timer);
  studio.timer = setInterval(tick, 1000);
  thread.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

async function runGeneration() {
  const form = $('#composer');
  const data = Object.fromEntries(new FormData(form));
  const text = data.source.trim();
  if (!text) return;
  if (findInappropriate(text).length) {
    // Refuse before sign-in or any request; the worker enforces the same rule.
    toast(INAPPROPRIATE_MESSAGE, 'error', 6000);
    form.classList.remove('shake');
    void form.offsetWidth;
    form.classList.add('shake');
    $('#source')?.focus();
    return;
  }
  if (!auth.currentUser()) {
    // Guests can write freely; signing in is asked for only when they generate. The draft is kept.
    if (!(await openAuthModal({ reason: 'برای ساخت پرامپت و ذخیره آن در تاریخچه، وارد شوید یا یک حساب رایگان بسازید.' }))) return;
    await new Promise((r) => setTimeout(r, 50)); // let the re-render after sign-in settle
  }
  const s = auth.settings();
  if (engine.engineFor(s) === 'claude' && !s.apiKey) {
    toast('ابتدا کلید API را در تنظیمات وارد کنید', 'error');
    navigate('/settings');
    return;
  }
  const options = { type: data.type, lang: data.lang, detail: data.detail };
  studio.controller = new AbortController();
  studio.startedAt = Date.now();
  studio.result = null;
  studio.pending = { source: text };
  const box = $('#source');
  if (box) { box.value = ''; box.style.height = 'auto'; }
  saveDraft({ source: '', ...options });
  showPending();

  try {
    const out = await engine.generate(text, options, s, studio.controller.signal);
    const record = await prompts.create(auth.currentUser().id, {
      source: text,
      title: out.title,
      promptEn: out.promptEn,
      promptFa: out.promptFa,
      improvements: out.notes,
      model: out.model,
      usage: out.usage,
      ...options,
    });
    studio.result = record;
    if (parseHash().path === '/studio') {
      syncQuery({ p: record.id });
      showThread(record, true);
    }
    renderSidebar();
    if (out.remaining != null) refreshQuotaNote(out.remaining);
  } catch (err) {
    const thread = $('#thread');
    if (thread && err.code !== 'aborted') {
      thread.innerHTML = `${userBubble(text)}
        <div class="msg msg-bot"><span class="bot-avatar">${logoMark()}</span>
          <div class="bot-body"><div class="error-card">${icon('info')}<div><strong>ساخت پرامپت انجام نشد</strong><p></p></div></div></div>
        </div>`;
      $('.error-card p', thread).textContent = err.message;
    }
    // Put the text back so nothing the user wrote is lost.
    const input = $('#source');
    if (input && !input.value) { input.value = text; input.dispatchEvent(new Event('input')); }
    if (err.code === 'aborted') {
      if (thread) thread.innerHTML = '';
      exitThreadMode();
      toast('لغو شد');
    }
  } finally {
    clearInterval(studio.timer);
    studio.controller = null;
    studio.pending = null;
    setBusy(false);
  }
}

function showThread(record, animate = false) {
  const thread = $('#thread');
  if (!thread) return;
  enterThreadMode();
  const langs = [record.promptFa && 'fa', record.promptEn && 'en'].filter(Boolean);
  const first = langs[0];
  thread.innerHTML = `
    ${userBubble(record.source)}
    <div class="msg msg-bot ${animate ? 'pop-in' : ''}">
      <span class="bot-avatar">${logoMark()}</span>
      <div class="bot-body">
        <h2 class="result-title" dir="auto"></h2>
        <p class="result-meta">${esc(engine.TARGETS[record.type]?.label || '')} · ${esc(engine.DETAILS[record.detail] || '')}</p>
        ${langs.length > 1 ? `
          <div class="tabs" role="tablist">
            ${langs.map((l) => `<button role="tab" class="tab ${l === first ? 'active' : ''}" data-tab="${l}" aria-selected="${l === first}">${l === 'fa' ? 'فارسی' : 'انگلیسی'}</button>`).join('')}
          </div>` : ''}
        ${langs.map((l) => `
          <div class="prompt-block" data-lang="${l}" ${l === first ? '' : 'hidden'}>
            <pre class="prompt-text" dir="${l === 'fa' ? 'rtl' : 'ltr'}" lang="${l}">${esc(l === 'fa' ? record.promptFa : record.promptEn)}</pre>
          </div>`).join('')}
        ${record.improvements?.length ? `
          <details class="improvements">
            <summary>${icon('sparkles')} چه چیزهایی بهتر شد؟</summary>
            <ul>${record.improvements.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
          </details>` : ''}
        <div class="msg-actions">
          <button class="icon-btn copy-btn" id="copy-result" aria-label="کپی" title="کپی">${icon('copy')}</button>
          <button class="icon-btn ${record.archived ? 'on' : ''}" id="archive-btn" aria-label="${record.archived ? 'در آرشیو' : 'ذخیره در آرشیو'}" title="${record.archived ? 'در آرشیو (ویرایش)' : 'ذخیره در آرشیو'}">${icon('archive')}</button>
          <button class="icon-btn ${record.pinned ? 'on' : ''}" id="pin-btn" aria-label="${record.pinned ? 'برداشتن پین' : 'پین کردن در منو'}" title="${record.pinned ? 'برداشتن پین' : 'پین کردن در منو'}">${icon('pin')}</button>
          <button class="icon-btn" id="refine-btn" aria-label="بهبود دوباره" title="بهبود دوباره">${icon('refresh')}</button>
          ${voice.canSpeak() ? `<button class="icon-btn" id="speak-btn" aria-label="خواندن با صدا" title="خواندن با صدا">${icon('volume')}</button>` : ''}
        </div>
      </div>
    </div>`;
  $('.result-title', thread).textContent = record.title || 'پرامپت جدید';
  const activeLang = () => $('.tab.active', thread)?.dataset.tab || first;

  $$('.tab', thread).forEach((tab) => tab.addEventListener('click', () => {
    $$('.tab', thread).forEach((t) => {
      t.classList.toggle('active', t === tab);
      t.setAttribute('aria-selected', String(t === tab));
    });
    $$('.prompt-block', thread).forEach((b) => { b.hidden = b.dataset.lang !== tab.dataset.tab; });
  }));
  $('#copy-result').addEventListener('click', (e) => copyText(activeLang() === 'fa' ? record.promptFa : record.promptEn, e.currentTarget));
  $('#archive-btn').addEventListener('click', async () => {
    const saved = await openArchiveDialog(record);
    if (saved) {
      studio.result = saved;
      showThread(saved);
      renderSidebar();
    }
  });
  $('#pin-btn').addEventListener('click', () => togglePin(record.id));
  $('#speak-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (btn.classList.contains('on')) { voice.stopSpeaking(); return; }
    const lang = activeLang();
    btn.classList.add('on');
    btn.innerHTML = icon('stop');
    try {
      await voice.speak(lang === 'fa' ? record.promptFa : record.promptEn, lang === 'fa' ? 'fa-IR' : 'en-US');
    } catch (err) {
      toast(err.message, 'error', 6000);
    } finally {
      btn.classList.remove('on');
      btn.innerHTML = icon('volume');
    }
  });
  $('#refine-btn').addEventListener('click', () => {
    const source = $('#source');
    source.value = activeLang() === 'fa' ? record.promptFa : record.promptEn;
    source.dispatchEvent(new Event('input'));
    source.focus();
  });
  if (animate) thread.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- Archive dialog (save / edit) ----------

async function openArchiveDialog(record, { editPrompts = false } = {}) {
  const user = auth.currentUser();
  const all = await prompts.listForUser(user.id);
  const { categories, tags } = prompts.facets(all);
  const saved = await modal({
    title: record.archived ? 'ویرایش پرامپت آرشیو' : 'ذخیره در آرشیو',
    size: editPrompts ? 'modal-lg' : '',
    body: `
      <form id="archive-form" class="form-grid">
        <label class="field"><span>عنوان</span><input name="title" dir="auto" maxlength="160" value="${esc(record.title)}" required></label>
        <label class="field"><span>${icon('folder')} پوشه / دسته‌بندی</span>
          <input name="category" dir="auto" list="category-list" maxlength="60" value="${esc(record.category)}" placeholder="مثلاً: طراحی، کد، مارکتینگ">
          <datalist id="category-list">${categories.map(([c]) => `<option value="${esc(c)}">`).join('')}</datalist>
        </label>
        <label class="field"><span>${icon('tag')} برچسب‌ها <small class="muted">(با کاما جدا کنید)</small></span>
          <input name="tags" dir="auto" value="${esc((record.tags || []).join('، '))}" placeholder="لوگو، مینیمال، کافه">
        </label>
        ${tags.length ? `<div class="chip-row" id="tag-suggest">${tags.slice(0, 14).map(([t]) => `<button type="button" class="chip chip-sm" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')}</div>` : ''}
        <label class="field"><span>یادداشت</span><textarea name="notes" dir="auto" rows="3" placeholder="هر توضیحی که بعداً کمکتان می‌کند…">${esc(record.notes)}</textarea></label>
        ${editPrompts ? `
          <label class="field"><span>پرامپت انگلیسی</span><textarea name="promptEn" dir="ltr" rows="7">${esc(record.promptEn)}</textarea></label>
          <label class="field"><span>پرامپت فارسی</span><textarea name="promptFa" dir="rtl" rows="7">${esc(record.promptFa)}</textarea></label>` : ''}
        <label class="check"><input type="checkbox" name="favorite" ${record.favorite ? 'checked' : ''}><span>${icon('star')} علاقه‌مندی</span></label>
      </form>`,
    actions: [
      { label: 'انصراف', class: 'btn-ghost', value: null },
      {
        label: 'ذخیره',
        class: 'btn-primary',
        onClick: async (root) => {
          const form = $('#archive-form', root);
          if (!form.reportValidity()) return undefined;
          const data = Object.fromEntries(new FormData(form));
          const patch = {
            title: data.title,
            category: data.category,
            tags: data.tags,
            notes: data.notes,
            favorite: Boolean(data.favorite),
          };
          if (editPrompts) Object.assign(patch, { promptEn: data.promptEn, promptFa: data.promptFa });
          const row = await prompts.archive(user.id, record.id, patch);
          toast('در آرشیو ذخیره شد', 'success');
          return row;
        },
      },
    ],
    onMount: (root) => {
      $$('#tag-suggest .chip', root).forEach((chip) => chip.addEventListener('click', () => {
        const input = $('input[name=tags]', root);
        const current = prompts.normalizeTags(input.value);
        if (!current.includes(chip.dataset.tag)) current.push(chip.dataset.tag);
        input.value = current.join('، ');
        chip.classList.add('active');
      }));
    },
  });
  return saved;
}

// ---------- Prompt card & detail ----------

function promptBlock(label, text, lang) {
  if (!text) return '';
  return `
    <div class="prompt-block" data-lang="${lang}">
      <div class="prompt-block-head">
        <span class="lang-pill">${label}</span>
        <button class="btn btn-sm btn-ghost copy-btn" data-copy="${lang}">${icon('copy')}<span>کپی</span></button>
      </div>
      <pre class="prompt-text" dir="${lang === 'fa' ? 'rtl' : 'ltr'}" lang="${lang}">${esc(text)}</pre>
    </div>`;
}

function metaBadges(r) {
  return `
    <span class="badge">${esc(engine.TARGETS[r.type]?.label || r.type)}</span>
    <span class="badge badge-muted">${esc(engine.LANGS[r.lang] || r.lang)}</span>
    ${r.category ? `<span class="badge badge-folder">${icon('folder')}${esc(r.category)}</span>` : ''}`;
}

function promptCard(r, terms = [], { showArchiveState = true } = {}) {
  const preview = r.promptFa || r.promptEn;
  return `
    <article class="prompt-card" data-id="${esc(r.id)}" tabindex="0">
      <header>
        <h3 dir="auto">${highlight(r.title || truncate(r.source, 60), terms)}</h3>
        <button class="icon-btn fav-btn ${r.favorite ? 'on' : ''}" data-act="fav" aria-label="علاقه‌مندی" title="علاقه‌مندی">${icon('star')}</button>
      </header>
      <p class="source" dir="auto">${highlight(truncate(r.source, 140), terms)}</p>
      <p class="preview" dir="auto">${highlight(truncate(preview, 200), terms)}</p>
      ${r.tags?.length ? `<div class="chip-row">${r.tags.map((t) => `<span class="chip chip-sm">#${highlight(t, terms)}</span>`).join('')}</div>` : ''}
      <footer>
        <div class="badges">${metaBadges(r)}${showArchiveState && r.archived ? `<span class="badge badge-ok">${icon('archive')}آرشیو</span>` : ''}</div>
        <div class="card-actions">
          <time datetime="${new Date(r.createdAt).toISOString()}" title="${esc(formatDate(r.createdAt))}">${esc(relativeTime(r.createdAt))}</time>
          <button class="icon-btn" data-act="copy" aria-label="کپی" title="کپی">${icon('copy')}</button>
          ${r.archived ? '' : `<button class="icon-btn" data-act="archive" aria-label="ذخیره در آرشیو" title="ذخیره در آرشیو">${icon('archive')}</button>`}
          <button class="icon-btn danger" data-act="delete" aria-label="حذف" title="حذف">${icon('trash')}</button>
        </div>
      </footer>
    </article>`;
}

async function openDetail(record, refresh) {
  const both = record.promptEn && record.promptFa;
  await modal({
    title: record.title || 'پرامپت',
    size: 'modal-lg',
    body: `
      <div class="detail">
        <div class="badges">${metaBadges(record)}${record.favorite ? `<span class="badge badge-star">${icon('star')}علاقه‌مندی</span>` : ''}</div>
        <p class="muted small">${esc(formatDate(record.createdAt))} · ${esc(record.model || '')}</p>
        <div class="detail-source"><strong>متن اولیه</strong><p dir="auto">${esc(record.source)}</p></div>
        <div class="prompt-blocks ${both ? 'two' : ''}">
          ${promptBlock('انگلیسی', record.promptEn, 'en')}
          ${promptBlock('فارسی', record.promptFa, 'fa')}
        </div>
        ${record.notes ? `<div class="detail-notes"><strong>یادداشت</strong><p dir="auto">${esc(record.notes)}</p></div>` : ''}
        ${record.tags?.length ? `<div class="chip-row">${record.tags.map((t) => `<span class="chip chip-sm">#${esc(t)}</span>`).join('')}</div>` : ''}
      </div>`,
    actions: [
      { label: 'باز کردن در استودیو', class: 'btn-ghost', onClick: () => { openInStudio(record); return true; } },
      ...(record.archived ? [{
        label: 'خروج از آرشیو',
        class: 'btn-ghost',
        onClick: async () => {
          await prompts.unarchive(auth.currentUser().id, record.id);
          toast('از آرشیو خارج شد (در تاریخچه باقی می‌ماند)');
          refresh();
          return true;
        },
      }] : []),
      record.archived
        ? { label: 'ویرایش', class: 'btn-soft', onClick: async (_root, close) => { close(true); const s = await openArchiveDialog(record, { editPrompts: true }); if (s) refresh(); return undefined; } }
        : { label: 'ذخیره در آرشیو', class: 'btn-primary', onClick: async (_root, close) => { close(true); const s = await openArchiveDialog(record); if (s) refresh(); return undefined; } },
    ],
    onMount: (root) => {
      $$('.copy-btn', root).forEach((b) => b.addEventListener('click', () => copyText(b.dataset.copy === 'fa' ? record.promptFa : record.promptEn, b)));
    },
  });
}

function openInStudio(record) {
  studio.result = record;
  navigate(`/studio?p=${encodeURIComponent(record.id)}`);
}

/** Wires card clicks inside `root` to actions. `refresh` re-renders the list. */
function bindCards(root, rows, refresh) {
  const user = auth.currentUser();
  const byId = new Map(rows.map((r) => [r.id, r]));
  root.addEventListener('click', async (e) => {
    const card = e.target.closest('.prompt-card');
    if (!card) return;
    const record = byId.get(card.dataset.id);
    if (!record) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'copy') {
      copyText(record.promptEn || record.promptFa, e.target.closest('button'));
    } else if (act === 'fav') {
      const updated = await prompts.update(user.id, record.id, { favorite: !record.favorite });
      byId.set(record.id, updated);
      e.target.closest('button').classList.toggle('on', updated.favorite);
      e.target.closest('button').classList.add('pulse');
      setTimeout(() => e.target.closest('button')?.classList.remove('pulse'), 400);
      Object.assign(record, updated);
    } else if (act === 'archive') {
      if (await openArchiveDialog(record)) refresh();
    } else if (act === 'delete') {
      const ok = await confirmDialog(record.archived ? 'این پرامپت از آرشیو و تاریخچه حذف می‌شود. ادامه می‌دهید؟' : 'این پرامپت از تاریخچه حذف شود؟', { title: 'حذف پرامپت', okLabel: 'حذف', danger: true });
      if (!ok) return;
      await prompts.remove(user.id, record.id);
      if (studio.result?.id === record.id) studio.result = null;
      card.classList.add('removing');
      setTimeout(refresh, 260);
      toast('حذف شد');
    } else {
      openDetail(record, refresh);
    }
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('prompt-card')) e.target.click();
  });
}

function emptyState(iconName, title, text, cta = '') {
  return `<div class="empty">${icon(iconName, 'icon-lg')}<h3>${title}</h3><p class="muted">${text}</p>${cta}</div>`;
}

// ---------- History ----------

function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86400000);
  if (diff === 0) return 'امروز';
  if (diff === 1) return 'دیروز';
  return new Intl.DateTimeFormat('fa-IR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

async function renderHistory(params) {
  const user = auth.currentUser();
  const rows = await prompts.listForUser(user.id);
  const q = params.get('q') || '';
  const type = params.get('type') || '';

  view.innerHTML = `
    <header class="page-head">
      <div><h1>تاریخچه</h1><p class="muted">همه پرامپت‌هایی که ساخته‌اید، به‌ترتیب زمان. <span class="count">${num(rows.length)} مورد</span></p></div>
      ${rows.some((r) => !r.archived) ? `<button class="btn btn-ghost btn-sm" id="clear-history">${icon('trash')} پاک کردن تاریخچه</button>` : ''}
    </header>
    <div class="toolbar">
      <label class="search">${icon('search')}<input id="history-q" type="search" dir="auto" placeholder="جستجو در تاریخچه…" value="${esc(q)}"></label>
      <select id="history-type" aria-label="نوع پرامپت">
        <option value="">همه انواع</option>
        ${Object.entries(engine.TARGETS).map(([k, v]) => `<option value="${k}" ${k === type ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}
      </select>
    </div>
    <div id="history-list"></div>`;

  const list = $('#history-list');
  const draw = () => {
    const query = $('#history-q').value;
    const t = $('#history-type').value;
    const found = prompts.search(rows, { q: query, type: t });
    const terms = prompts.queryTerms(query);
    if (!rows.length) {
      list.innerHTML = emptyState('history', 'هنوز پرامپتی نساخته‌اید', 'اولین پرامپت خود را در استودیو بسازید؛ اینجا به‌صورت خودکار ذخیره می‌شود.', '<a class="btn btn-primary" href="#/studio">ساخت اولین پرامپت</a>');
      return;
    }
    if (!found.length) {
      list.innerHTML = emptyState('search', 'نتیجه‌ای پیدا نشد', 'عبارت دیگری را امتحان کنید.');
      return;
    }
    const groups = new Map();
    for (const r of found) {
      const label = dayLabel(r.createdAt);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(r);
    }
    list.innerHTML = [...groups.entries()].map(([label, items]) => `
      <section class="day-group">
        <h2 class="day-label">${esc(label)}</h2>
        <div class="card-list">${items.map((r) => promptCard(r, terms)).join('')}</div>
      </section>`).join('');
    staggerCards(list);
  };

  let t;
  $('#history-q').addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => { syncQuery({ q: $('#history-q').value, type: $('#history-type').value }); draw(); }, 180);
  });
  $('#history-type').addEventListener('change', () => { syncQuery({ q: $('#history-q').value, type: $('#history-type').value }); draw(); });
  $('#clear-history')?.addEventListener('click', async () => {
    const ok = await confirmDialog('همه پرامپت‌های تاریخچه که در آرشیو ذخیره نشده‌اند حذف می‌شوند. موارد آرشیو باقی می‌مانند.', { title: 'پاک کردن تاریخچه', okLabel: 'پاک کردن', danger: true });
    if (!ok) return;
    await prompts.clearHistory(user.id);
    toast('تاریخچه پاک شد');
    route();
  });
  bindCards(list, rows, route);
  draw();
}

function staggerCards(root) {
  $$('.prompt-card', root).forEach((card, i) => {
    card.style.animationDelay = `${Math.min(i, 12) * 35}ms`;
    card.classList.add('card-enter');
  });
}

// ---------- Archive ----------

const ARCHIVE_FILTERS = ['q', 'category', 'tag', 'type', 'lang', 'favorite', 'range', 'sort'];
const DATE_RANGES = { '': 'همه زمان‌ها', today: 'امروز', week: '۷ روز اخیر', month: '۳۰ روز اخیر', year: '۱ سال اخیر' };

/** Converts a named date range into the {from} bound (YYYY-MM-DD, local time) that prompts.search expects. */
function rangeToFrom(range) {
  const days = { today: 0, week: 6, month: 29, year: 364 }[range];
  if (days === undefined) return '';
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function renderArchive(params) {
  const user = auth.currentUser();
  const all = await prompts.listForUser(user.id);
  const rows = all.filter((r) => r.archived);
  const f = Object.fromEntries(ARCHIVE_FILTERS.map((k) => [k, params.get(k) || '']));
  const { categories, tags } = prompts.facets(rows);
  const advancedOpen = Boolean(f.category || f.type || f.lang || f.range || f.favorite || (f.sort && f.sort !== 'newest'));

  view.innerHTML = `
    <header class="page-head">
      <div><h1>آرشیو</h1><p class="muted">پرامپت‌های منتخب شما با پوشه، برچسب و جستجوی پیشرفته. <span class="count">${num(rows.length)} مورد</span></p></div>
    </header>
    <form class="card filters" id="filters" role="search">
      <div class="filters-main">
        <label class="search search-lg">${icon('search')}<input name="q" type="search" dir="auto" placeholder="جستجو در عنوان، متن، پرامپت‌ها، یادداشت و برچسب‌ها…" value="${esc(f.q)}"></label>
        <button type="button" class="btn btn-ghost ${advancedOpen ? 'active' : ''}" id="toggle-advanced" aria-expanded="${advancedOpen}">${icon('filter')}<span>فیلترها</span></button>
      </div>
      <div class="filters-advanced ${advancedOpen ? 'open' : ''}" id="advanced">
        <div class="filters-grid">
          <label class="field"><span>${icon('folder')} پوشه</span>
            <select name="category"><option value="">همه</option>${categories.map(([c, n]) => `<option value="${esc(c)}" ${c === f.category ? 'selected' : ''}>${esc(c)} (${num(n)})</option>`).join('')}</select></label>
          <label class="field"><span>نوع</span>
            <select name="type"><option value="">همه</option>${Object.entries(engine.TARGETS).map(([k, v]) => `<option value="${k}" ${k === f.type ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>
          <label class="field"><span>زبان</span>
            <select name="lang"><option value="">همه</option>${Object.entries(engine.LANGS).map(([k, v]) => `<option value="${k}" ${k === f.lang ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
          <label class="field"><span>مرتب‌سازی</span>
            <select name="sort">
              <option value="newest" ${f.sort === 'newest' || !f.sort ? 'selected' : ''}>جدیدترین</option>
              <option value="oldest" ${f.sort === 'oldest' ? 'selected' : ''}>قدیمی‌ترین</option>
              <option value="updated" ${f.sort === 'updated' ? 'selected' : ''}>آخرین ویرایش</option>
              <option value="title" ${f.sort === 'title' ? 'selected' : ''}>عنوان (الفبا)</option>
            </select></label>
          <label class="field"><span>بازه زمانی</span>
            <select name="range">${Object.entries(DATE_RANGES).map(([k, v]) => `<option value="${k}" ${k === f.range ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        </div>
        <div class="filters-foot">
          <label class="check"><input type="checkbox" name="favorite" value="1" ${f.favorite ? 'checked' : ''}><span>${icon('star')} فقط علاقه‌مندی‌ها</span></label>
          <button type="button" class="btn btn-sm btn-ghost" id="reset-filters">${icon('x')} حذف فیلترها</button>
        </div>
      </div>
      ${tags.length ? `
        <div class="chip-row tag-cloud" aria-label="برچسب‌ها">
          <input type="hidden" name="tag" value="${esc(f.tag)}">
          ${tags.map(([t, n]) => `<button type="button" class="chip ${t === f.tag ? 'active' : ''}" data-tag="${esc(t)}">#${esc(t)} <small>${num(n)}</small></button>`).join('')}
        </div>` : '<input type="hidden" name="tag" value="">'}
    </form>
    <div class="result-bar"><span id="result-count"></span></div>
    <div id="archive-list" class="card-grid"></div>`;

  const form = $('#filters');
  const list = $('#archive-list');
  const read = () => {
    const data = Object.fromEntries(new FormData(form));
    return { ...data, favorite: data.favorite ? '1' : '' };
  };
  const draw = () => {
    const current = read();
    syncQuery(current);
    const found = prompts.search(rows, { ...current, from: rangeToFrom(current.range), favorite: Boolean(current.favorite) });
    const terms = prompts.queryTerms(current.q);
    $('#result-count').textContent = rows.length ? `${num(found.length)} نتیجه از ${num(rows.length)}` : '';
    if (!rows.length) {
      list.innerHTML = emptyState('archive', 'آرشیو خالی است', 'بعد از ساخت پرامپت، دکمه «ذخیره در آرشیو» را بزنید تا با عنوان، پوشه و برچسب اینجا نگهداری شود.', '<a class="btn btn-primary" href="#/studio">رفتن به استودیو</a>');
    } else if (!found.length) {
      list.innerHTML = emptyState('search', 'نتیجه‌ای پیدا نشد', 'فیلترها را تغییر دهید یا حذف کنید.');
    } else {
      list.innerHTML = found.map((r) => promptCard(r, terms, { showArchiveState: false })).join('');
      staggerCards(list);
    }
  };

  let t;
  form.addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(draw, e.target.name === 'q' ? 180 : 0);
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); draw(); });
  $('#toggle-advanced').addEventListener('click', (e) => {
    const open = $('#advanced').classList.toggle('open');
    e.currentTarget.classList.toggle('active', open);
    e.currentTarget.setAttribute('aria-expanded', String(open));
  });
  $('#reset-filters').addEventListener('click', () => {
    form.reset();
    $$('input, select', form).forEach((el) => {
      if (el.type === 'checkbox') el.checked = false;
      else if (el.name === 'sort') el.value = 'newest';
      else el.value = '';
    });
    $$('.tag-cloud .chip', form).forEach((c) => c.classList.remove('active'));
    draw();
  });
  $$('.tag-cloud .chip', form).forEach((chip) => chip.addEventListener('click', () => {
    const input = $('input[name=tag]', form);
    input.value = input.value === chip.dataset.tag ? '' : chip.dataset.tag;
    $$('.tag-cloud .chip', form).forEach((c) => c.classList.toggle('active', c.dataset.tag === input.value));
    draw();
  }));
  bindCards(list, rows, route);
  draw();
}

// ---------- Profile ----------

async function renderProfile() {
  const user = auth.currentUser();
  const rows = await prompts.listForUser(user.id);
  const archived = rows.filter((r) => r.archived).length;
  const favorites = rows.filter((r) => r.favorite).length;

  view.innerHTML = `
    <header class="page-head"><div><h1>حساب کاربری</h1><p class="muted">اطلاعات، آواتار و امنیت حساب.</p></div>
      <button class="btn btn-ghost btn-sm" id="logout-btn">${icon('logout')} خروج</button>
    </header>
    <section class="profile-hero card">
      <div class="avatar-edit">
        <div id="avatar-slot">${avatarHtml(user, 'xl')}</div>
        <label class="avatar-upload" title="تغییر آواتار">${icon('camera')}<input type="file" id="avatar-input" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label>
      </div>
      <div class="profile-id">
        <h2></h2>
        <p class="muted" dir="ltr"></p>
        <p class="muted small">عضویت از ${esc(formatDate(user.createdAt))}</p>
        ${user.avatar ? '<button class="btn btn-sm btn-ghost" id="avatar-remove">حذف آواتار</button>' : ''}
      </div>
      <div class="stats">
        <div><strong>${num(rows.length)}</strong><span>پرامپت ساخته‌شده</span></div>
        <div><strong>${num(archived)}</strong><span>در آرشیو</span></div>
        <div><strong>${num(favorites)}</strong><span>علاقه‌مندی</span></div>
      </div>
    </section>
    <div class="grid-2">
      <form class="card" id="profile-form">
        <h2 class="card-title">${icon('user')} اطلاعات حساب</h2>
        <label class="field"><span>نام</span><input name="name" required minlength="2" value="${esc(user.name)}"></label>
        <label class="field"><span>ایمیل</span><input name="email" type="email" dir="ltr" required value="${esc(user.email)}"></label>
        <button class="btn btn-primary" type="submit">ذخیره تغییرات</button>
      </form>
      <form class="card" id="password-form">
        <h2 class="card-title">${icon('key')} ${auth.hasPassword() ? 'تغییر رمز عبور' : 'تعیین رمز عبور'}</h2>
        ${auth.hasPassword() ? '' : '<p class="muted small">حساب شما با گوگل ساخته شده است. با تعیین رمز، با ایمیل هم می‌توانید وارد شوید.</p>'}
        ${auth.needsOldPassword() ? '<label class="field"><span>رمز فعلی</span><input name="old" type="password" dir="ltr" autocomplete="current-password" required></label>' : ''}
        <label class="field"><span>رمز جدید</span><input name="new" type="password" dir="ltr" autocomplete="new-password" minlength="6" required></label>
        <button class="btn btn-primary" type="submit">${auth.hasPassword() ? 'تغییر رمز' : 'تعیین رمز'}</button>
      </form>
    </div>
    ${auth.hasPassword() ? `
    <section class="card">
      <h2 class="card-title">${icon('key')} کد بازیابی رمز عبور</h2>
      <p class="muted small">${auth.hasRecoveryCode() ? 'اگر کد بازیابی را گم کرده‌اید، یک کد جدید بسازید؛ کد قبلی باطل می‌شود.' : 'هنوز کد بازیابی ندارید. بدون آن، در صورت فراموشی رمز، راهی برای بازیابی حساب وجود ندارد.'}</p>
      <div class="form-actions start"><button class="btn btn-soft btn-sm" id="new-recovery">ساخت کد بازیابی جدید</button></div>
    </section>` : ''}
    <section class="card danger-zone">
      <h2 class="card-title">${icon('trash')} حذف حساب</h2>
      <p class="muted">حساب و همه پرامپت‌های آن برای همیشه از همه دستگاه‌ها و سرور حذف می‌شود. پیش از آن از تنظیمات پشتیبان بگیرید.</p>
      <button class="btn btn-danger btn-sm" id="delete-account">حذف حساب</button>
    </section>`;
  $('.profile-id h2').textContent = user.name;
  $('.profile-id p').textContent = user.email;
  paintAvatars(view);

  $('#logout-btn').addEventListener('click', logout);
  $('#avatar-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await auth.setAvatar(await auth.imageFileToAvatar(file));
      toast('آواتار به‌روز شد', 'success');
      route();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  $('#avatar-remove')?.addEventListener('click', async () => {
    await auth.setAvatar(null);
    route();
  });
  $('#profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await auth.updateProfile(Object.fromEntries(new FormData(e.target)));
      toast('اطلاعات ذخیره شد', 'success');
      route();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  $('#password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    try {
      const first = !auth.hasPassword();
      await auth.changePassword(data.old, data.new);
      toast(first ? 'رمز عبور تعیین شد' : 'رمز عبور تغییر کرد', 'success');
      if (first || !auth.hasRecoveryCode()) await showRecoveryCode(await auth.createRecoveryCode(), { fresh: false });
      route();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  $('#new-recovery')?.addEventListener('click', async () => {
    if (auth.hasRecoveryCode() && !(await confirmDialog('کد بازیابی قبلی باطل می‌شود. ادامه می‌دهید؟', { title: 'کد بازیابی جدید' }))) return;
    await showRecoveryCode(await auth.createRecoveryCode(), { fresh: false });
    route();
  });
  $('#delete-account').addEventListener('click', async () => {
    const withPassword = auth.hasPassword();
    const password = await modal({
      title: 'حذف حساب',
      size: 'modal-sm',
      body: `<p class="confirm-text">برای تأیید، ${withPassword ? 'رمز عبور' : 'ایمیل حساب'} خود را وارد کنید. این کار قابل بازگشت نیست.</p>
        <label class="field"><span>${withPassword ? 'رمز عبور' : 'ایمیل'}</span><input id="confirm-pass" type="${withPassword ? 'password' : 'email'}" dir="ltr" autocomplete="${withPassword ? 'current-password' : 'off'}"></label>`,
      actions: [
        { label: 'انصراف', class: 'btn-ghost', value: null },
        { label: 'حذف همیشگی', class: 'btn-danger', onClick: (root) => $('#confirm-pass', root).value || undefined },
      ],
    });
    if (!password) return;
    try {
      await auth.deleteAccount(password);
      studio.result = null;
      toast('حساب حذف شد');
      navigate('/studio');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// ---------- Settings ----------

function renderSettings() {
  const s = auth.settings();
  view.innerHTML = `
    <header class="page-head"><div><h1>تنظیمات</h1><p class="muted">موتور هوش مصنوعی، پیش‌فرض‌ها، ظاهر و پشتیبان‌گیری.</p></div></header>
    <form class="card" id="api-form">
      <h2 class="card-title">${icon('sparkles')} موتور هوش مصنوعی</h2>
      <div class="segmented" id="engine-choice">
        ${Object.entries(engine.ENGINES).map(([k, l]) => `<label class="seg ${engine.engineFor(s) === k ? 'active' : ''}"><input type="radio" name="engine" value="${k}" ${engine.engineFor(s) === k ? 'checked' : ''}><span>${esc(l)}</span></label>`).join('')}
      </div>
      <p class="muted small engine-note" data-engine="free">رایگان و بدون نیاز به کلید. هر کاربر روزانه تعداد محدودی پرامپت رایگان دارد.${engine.freeServiceReady() ? '' : ' <strong>(این سرویس هنوز روی سایت فعال نشده است.)</strong>'}</p>
      <div class="claude-settings" data-engine="claude">
      <p class="muted small">با کلید API خودتان از <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>، بدون محدودیت روزانه. هزینه از حساب API شما کم می‌شود. کلید فقط در همین مرورگر ذخیره می‌شود و مستقیماً به سرور Anthropic فرستاده می‌شود.</p>
      <label class="field"><span>کلید API</span>
        <div class="input-group">
          <input name="apiKey" id="api-key" type="password" dir="ltr" autocomplete="off" spellcheck="false" placeholder="sk-ant-..." value="${esc(s.apiKey)}">
          <button type="button" class="btn btn-ghost btn-sm" id="toggle-key">نمایش</button>
        </div>
      </label>
      <div class="grid-2 tight">
        <label class="field"><span>مدل</span>
          <select name="model">${engine.MODELS.map((m) => `<option value="${m.id}" ${m.id === s.model ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>
        <label class="field"><span>عمق فکر کردن</span>
          <select name="effort">
            ${[['low', 'کم — سریع‌تر'], ['medium', 'متوسط — پیشنهادی'], ['high', 'زیاد — دقیق‌تر'], ['xhigh', 'خیلی زیاد']].map(([v, l]) => `<option value="${v}" ${v === s.effort ? 'selected' : ''}>${l}</option>`).join('')}
          </select></label>
      </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="test-key" data-engine="claude">آزمایش اتصال</button>
        <button type="submit" class="btn btn-primary">ذخیره</button>
      </div>
    </form>
    <form class="card" id="defaults-form">
      <h2 class="card-title">${icon('sparkles')} پیش‌فرض‌های استودیو</h2>
      <div class="grid-3 tight">
        <label class="field"><span>نوع پرامپت</span><select name="defaultType">${Object.entries(engine.TARGETS).map(([k, v]) => `<option value="${k}" ${k === s.defaultType ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>
        <label class="field"><span>زبان خروجی</span><select name="defaultLang">${Object.entries(engine.LANGS).map(([k, v]) => `<option value="${k}" ${k === s.defaultLang ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <label class="field"><span>میزان جزئیات</span><select name="defaultDetail">${Object.entries(engine.DETAILS).map(([k, v]) => `<option value="${k}" ${k === s.defaultDetail ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
      </div>
      <div class="form-actions"><button type="submit" class="btn btn-primary">ذخیره</button></div>
    </form>
    <section class="card">
      <h2 class="card-title">${icon('sun')} ظاهر</h2>
      <div class="segmented" id="theme-choice">
        ${[['light', 'روشن'], ['dark', 'تیره'], ['system', 'مطابق سیستم']].map(([v, l]) => `<label class="seg ${(document.documentElement.dataset.theme || 'system') === v ? 'active' : ''}"><input type="radio" name="theme" value="${v}" ${(document.documentElement.dataset.theme || 'system') === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}
      </div>
    </section>
    <section class="card">
      <h2 class="card-title">${icon('download')} پشتیبان‌گیری</h2>
      <p class="muted small">همه پرامپت‌ها (تاریخچه و آرشیو) را در یک فایل JSON ذخیره کنید یا از فایل پشتیبان بازگردانید؛ برای انتقال به مرورگر یا دستگاه دیگر.</p>
      <div class="form-actions start">
        <button class="btn btn-soft" id="export-btn">${icon('download')} دریافت فایل پشتیبان</button>
        <label class="btn btn-ghost">${icon('upload')} بازگردانی از فایل<input type="file" id="import-input" accept="application/json,.json" hidden></label>
      </div>
    </section>`;

  const keyInput = $('#api-key');
  const showEngine = (value) => {
    $$('#api-form [data-engine]').forEach((el) => { el.hidden = el.dataset.engine !== value; });
  };
  showEngine(engine.engineFor(s));
  $('#engine-choice').addEventListener('change', (e) => {
    $$('#engine-choice .seg').forEach((seg) => seg.classList.toggle('active', seg.contains(e.target)));
    showEngine(e.target.value);
  });
  $('#toggle-key').addEventListener('click', (e) => {
    const show = keyInput.type === 'password';
    keyInput.type = show ? 'text' : 'password';
    e.currentTarget.textContent = show ? 'پنهان' : 'نمایش';
  });
  $('#api-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    if (data.engine === 'claude' && !data.apiKey.trim()) {
      toast('برای موتور Claude کلید API را وارد کنید', 'error');
      return;
    }
    await auth.updateSettings({ engine: data.engine, apiKey: data.apiKey.trim(), model: data.model, effort: data.effort });
    toast('تنظیمات موتور ذخیره شد', 'success');
  });
  $('#test-key').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const key = keyInput.value.trim();
    if (!key) { toast('ابتدا کلید را وارد کنید', 'error'); return; }
    btn.disabled = true;
    btn.classList.add('loading');
    try {
      await engine.testKey(key);
      toast('اتصال برقرار است ✓', 'success');
    } catch (err) {
      toast(err.message, 'error', 5000);
    } finally {
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  });
  $('#defaults-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await auth.updateSettings(Object.fromEntries(new FormData(e.target)));
    saveDraft(null);
    toast('پیش‌فرض‌ها ذخیره شد', 'success');
  });
  $('#theme-choice').addEventListener('change', (e) => {
    const value = e.target.value;
    $$('#theme-choice .seg').forEach((seg) => seg.classList.toggle('active', seg.contains(e.target)));
    applyTheme(value);
    try {
      if (value === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, value);
    } catch { /* ignore */ }
    renderSidebar();
    renderTopbar();
  });
  $('#export-btn').addEventListener('click', async () => {
    const data = await prompts.exportData(auth.currentUser());
    const stamp = new Date().toISOString().slice(0, 10);
    download(`promptcreator-backup-${stamp}.json`, JSON.stringify(data, null, 2));
    toast('فایل پشتیبان آماده شد', 'success');
  });
  $('#import-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const count = await prompts.importData(auth.currentUser().id, JSON.parse(await file.text()));
      toast(`${num(count)} پرامپت بازگردانی شد`, 'success');
    } catch (err) {
      toast(err instanceof SyntaxError ? 'فایل JSON معتبر نیست.' : err.message, 'error');
    }
  });
}

// ---------- Help & rules ----------

// ---------- Admin panel (only for the admin account; the server enforces it too) ----------

async function renderAdmin() {
  view.innerHTML = `
    <header class="page-head">
      <div><h1>پنل مدیریت</h1><p class="muted">آمار پرامپت‌ساز و مدیریت حساب‌ها. متن پرامپت‌های کاربران اینجا نمایش داده نمی‌شود.</p></div>
      <button class="btn btn-soft" id="admin-refresh">${icon('refresh')} به‌روزرسانی</button>
    </header>
    <section class="admin-stats" id="admin-stats" aria-busy="true">${'<div class="stat-card skeleton"></div>'.repeat(4)}</section>
    <section class="card admin-users">
      <div class="admin-users-head">
        <h2 class="card-title">${icon('user')} کاربران</h2>
        <input type="search" id="admin-q" class="input" placeholder="جستجوی نام یا ایمیل" dir="auto" autocomplete="off">
      </div>
      <div id="admin-list" class="admin-list"></div>
      <div class="form-actions start"><button class="btn btn-soft btn-sm" id="admin-more" hidden>نمایش بیشتر</button></div>
    </section>`;

  const stat = (label, value, sub = '') => `
    <article class="stat-card"><span>${esc(label)}</span><strong>${num(value)}</strong>${sub ? `<small>${sub}</small>` : ''}</article>`;

  async function loadStats() {
    const box = $('#admin-stats');
    try {
      const s = await api.request('GET', '/admin/stats');
      const q = s.quota;
      const used = q ? Math.min(100, Math.round((q.usedToday / Math.max(1, q.limitToday)) * 100)) : 0;
      box.innerHTML = `
        ${stat('کاربران', s.users.total, `امروز +${num(s.users.today)} · ۷ روز +${num(s.users.week)}`)}
        ${stat('کاربران فعال امروز', s.users.activeToday, `۷ روز گذشته: ${num(s.users.activeWeek)}`)}
        ${stat('پرامپت‌ها', s.prompts.total, `امروز ${num(s.prompts.today)} · ۷ روز ${num(s.prompts.week)} · آرشیو ${num(s.prompts.archived)}`)}
        ${stat('نوع ورود', s.users.google, `گوگل · ${num(s.users.password)} با رمز · ${num(s.users.blocked)} مسدود`)}
        ${q ? `<article class="stat-card stat-wide"><span>مصرف سرویس رایگان امروز</span><strong>${num(q.usedToday)} <small>از ${num(q.limitToday)}</small></strong>
          <div class="meter"><div class="meter-fill"></div></div>
          <small>سقف هر کاربر در روز: ${num(q.perVisitor)} پرامپت · حداکثر ${num(q.perMinute)} درخواست در دقیقه</small></article>` : ''}`;
      const fill = $('.meter-fill', box);
      if (fill) {
        fill.style.width = `${used}%`;
        fill.classList.toggle('warn', used >= 80);
      }
    } catch (err) {
      box.innerHTML = '<p class="muted"></p>';
      $('p', box).textContent = err.message;
    }
    box.removeAttribute('aria-busy');
  }

  let offset = 0;
  let query = '';
  let token = 0;
  async function loadUsers(append = false) {
    const mine = ++token;
    if (!append) offset = 0;
    const list = $('#admin-list');
    try {
      const res = await api.request('GET', `/admin/users?q=${encodeURIComponent(query)}&offset=${offset}`);
      if (mine !== token) return;
      const rows = res.users.map((u) => `
        <div class="admin-row ${u.blocked ? 'is-blocked' : ''}" data-id="${esc(u.id)}">
          ${avatarHtml(u, 'sm')}
          <div class="admin-who">
            <strong dir="auto">${esc(u.name)}</strong>
            <small dir="ltr">${esc(u.email)}</small>
          </div>
          <div class="admin-tags">
            ${u.admin ? '<span class="tag tag-brand">مدیر</span>' : ''}
            ${u.google ? '<span class="tag">گوگل</span>' : ''}
            ${u.password ? '<span class="tag">رمز</span>' : ''}
            ${u.blocked ? '<span class="tag tag-danger">مسدود</span>' : ''}
          </div>
          <div class="admin-meta">
            <span>${num(u.prompts)} پرامپت</span>
            <small>عضویت ${esc(formatDate(u.createdAt))}</small>
            <small>${u.lastSeen ? `آخرین فعالیت ${esc(relativeTime(u.lastSeen))}` : 'بدون فعالیت'}</small>
          </div>
          <div class="admin-actions">
            ${u.admin ? '' : `
              <button class="btn btn-ghost btn-sm" data-act="${u.blocked ? 'unblock' : 'block'}">${u.blocked ? 'رفع مسدودی' : 'مسدود کردن'}</button>
              <button class="icon-btn" data-act="delete" aria-label="حذف حساب" title="حذف حساب">${icon('trash')}</button>`}
          </div>
        </div>`).join('');
      if (append) list.insertAdjacentHTML('beforeend', rows);
      else list.innerHTML = rows || '<p class="muted">کاربری پیدا نشد.</p>';
      paintAvatars(list);
      $('#admin-more').hidden = !res.more;
      offset += res.users.length;
    } catch (err) {
      list.innerHTML = '<p class="muted"></p>';
      $('p', list).textContent = err.message;
    }
  }

  $('#admin-refresh').addEventListener('click', () => { loadStats(); loadUsers(); });
  $('#admin-more').addEventListener('click', () => loadUsers(true));
  let debounce = null;
  $('#admin-q').addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { query = e.target.value.trim(); loadUsers(); }, 300);
  });
  $('#admin-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const row = btn.closest('.admin-row');
    const name = $('.admin-who strong', row).textContent;
    const act = btn.dataset.act;
    const questions = {
      block: [`حساب «${name}» مسدود شود؟ کاربر از همه دستگاه‌ها خارج می‌شود و تا رفع مسدودی نمی‌تواند وارد شود.`, 'مسدود کردن'],
      unblock: [`مسدودی حساب «${name}» برداشته شود؟`, 'رفع مسدودی'],
      delete: [`حساب «${name}» و همه پرامپت‌هایش برای همیشه حذف شود؟ این کار قابل بازگشت نیست.`, 'حذف همیشگی'],
    };
    const [message, okLabel] = questions[act];
    if (!(await confirmDialog(message, { title: 'مدیریت کاربر', okLabel, danger: act !== 'unblock' }))) return;
    try {
      await api.request('POST', '/admin/users/action', { id: row.dataset.id, action: act });
      toast('انجام شد', 'success');
      loadStats();
      loadUsers();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  await Promise.all([loadStats(), loadUsers()]);
}

function renderHelp() {
  const topics = [
    ['sparkles', 'پرامپت‌ساز چیست؟', 'ایده، درخواست یا یادداشت خامتان را به فارسی یا انگلیسی (حتی محاوره‌ای و نامرتب) بنویسید؛ پرامپت‌ساز آن را به یک پرامپت حرفه‌ای، ساختاریافته و دقیق برای ChatGPT، Claude، Gemini، ابزارهای ساخت تصویر و ویدیو یا دستیارهای برنامه‌نویسی تبدیل می‌کند؛ به فارسی، انگلیسی یا هر دو.'],
    ['edit', 'ساخت اولین پرامپت', 'در صفحه اصلی متن خود را بنویسید و دکمه ارسال (فلش) را بزنید یا Enter را فشار دهید. برای رفتن به خط بعد Shift+Enter بزنید. اگر وارد نشده باشید، پنجره ورود باز می‌شود و بعد از ورود ساخت پرامپت خودکار ادامه پیدا می‌کند.'],
    ['sliders', 'گزینه‌های ساخت', '«نوع پرامپت» را روی «تشخیص خودکار» بگذارید تا نوع مناسب (برنامه‌نویسی، تصویر، ویدیو، نویسندگی، تحقیق، بازاریابی، ایجنت یا عمومی) خودکار انتخاب شود، یا خودتان انتخاب کنید. «زبان خروجی» و «میزان جزئیات» (خلاصه، متعادل، جامع) را هم کنار کادر نوشتن تعیین کنید.'],
    ['copy', 'استفاده از نتیجه', 'نتیجه با زبانه‌های فارسی و انگلیسی نمایش داده می‌شود. با دکمه کپی آن را بردارید، با دکمه آرشیو ذخیره‌اش کنید و با «بهبود دوباره» نتیجه را به ورودی جدید تبدیل کنید تا باز هم بهترش کنید. زیر هر نتیجه «چه چیزهایی بهتر شد؟» تغییرات را توضیح می‌دهد.'],
    ['history', 'تاریخچه و جستجو', 'هر پرامپتی که می‌سازید خودکار ذخیره می‌شود و در منوی کناری (امروز، دیروز، ۷ روز گذشته و…) دیده می‌شود. در «جستجوی پرامپت‌ها» همه را بر اساس متن و نوع پیدا کنید. جستجو «ي/ی» و «ك/ک» و اعداد فارسی و انگلیسی را یکسان در نظر می‌گیرد.'],
    ['pin', 'پین کردن پرامپت‌ها', 'پرامپت‌های پرکاربرد را با آیکون سنجاق (کنار هر پرامپت در منوی کناری یا زیر نتیجه) پین کنید تا همیشه در بخش «پین‌شده‌ها» بالای منو بمانند. وقتی منو بسته است، دو دکمه «پین‌شده‌ها» و «اخیر» (۱۰ پرامپت آخر) فهرست را کنار منو باز می‌کنند.'],
    ['archive', 'آرشیو پیشرفته', 'پرامپت‌های مهم را با عنوان، پوشه، برچسب، یادداشت و علاقه‌مندی در آرشیو نگه دارید. در آرشیو بر اساس کلمه، پوشه، برچسب، نوع، زبان، بازه زمانی و علاقه‌مندی فیلتر و مرتب کنید، و متن پرامپت‌ها را ویرایش کنید.'],
    ['user', 'حساب کاربری و ورود', 'با گوگل یا با ایمیل و رمز وارد شوید. با «مرا به خاطر بسپار» بعد از بستن مرورگر هم وارد می‌مانید. بعد از ثبت‌نام یک کد بازیابی می‌گیرید؛ اگر رمز را فراموش کردید با «فراموشی رمز» و همین کد رمز جدید بگذارید. آواتار، نام، ایمیل و رمز را در «حساب کاربری» تغییر دهید.'],
    ['sun', 'تم روشن و تیره', 'با دکمه خورشید/ماه بالای صفحه یا از منوی حساب، تم را عوض کنید. در «تنظیمات» می‌توانید «مطابق سیستم» را هم انتخاب کنید.'],
    ['download', 'همگام‌سازی و پشتیبان‌گیری', 'حساب و پرامپت‌ها در حساب شما روی سرور ذخیره می‌شوند؛ با همان ایمیل یا گوگل در سایت، اپ اندروید یا هر دستگاه دیگری وارد شوید تا همه پرامپت‌ها را ببینید. بدون اینترنت هم پرامپت‌های قبلی در دسترس‌اند و تغییرات بعداً همگام می‌شوند. از «تنظیمات ← پشتیبان‌گیری» هم می‌توانید فایل پشتیبان بگیرید. تنظیمات (مثل کلید API) فقط روی همان دستگاه می‌ماند.'],
    ['key', 'سهمیه رایگان و Claude', 'ساخت پرامپت رایگان است و هر کاربر سهمیه روزانه دارد که زیر کادر نوشتن نمایش داده می‌شود. اگر کلید API شخصی Claude دارید، در «تنظیمات» موتور «Claude با کلید شخصی» را انتخاب کنید تا بدون سقف روزانه کار کنید.'],
  ];
  view.innerHTML = `
    <header class="page-head"><div><h1>راهنمای پرامپت‌ساز</h1><p class="muted">همه چیز درباره قابلیت‌ها و نحوه استفاده.</p></div>
      <button class="btn btn-soft" id="show-news">${icon('sparkles')} تازه‌های نسخه‌ها</button></header>
    <div class="help-grid">
      ${topics.map(([ic, title, body]) => `
        <article class="help-card">
          <span class="help-icon">${icon(ic)}</span>
          <h2>${title}</h2>
          <p>${body}</p>
        </article>`).join('')}
    </div>
    <section class="card help-cta">
      <div><h2>آماده‌اید؟</h2><p class="muted">اولین پرامپت حرفه‌ای‌تان را همین حالا بسازید.</p></div>
      <a class="btn btn-primary btn-pill" href="#/studio">شروع ساخت پرامپت</a>
    </section>`;
  $('#show-news').addEventListener('click', () => updates.showChangelog());
}

function renderRules() {
  const rules = [
    ['ممنوعیت محتوای نامناسب', 'استفاده از کلمات رکیک، توهین‌آمیز، جنسی، نفرت‌پراکن یا تبعیض‌آمیز مجاز نیست. سامانه این متن‌ها را خودکار تشخیص می‌دهد و برای آن‌ها پرامپت نمی‌سازد.'],
    ['ممنوعیت استفاده غیرقانونی یا آسیب‌زا', 'ساخت پرامپت برای فعالیت‌های غیرقانونی، کلاه‌برداری، آزار و اذیت، نقض حریم خصوصی دیگران یا تولید محتوای خطرناک ممنوع است.'],
    ['اطلاعات محرمانه وارد نکنید', 'در سرویس رایگان، متن شما برای پردازش به سرویس هوش مصنوعی گوگل (Gemini) فرستاده می‌شود و ممکن است برای بهبود مدل‌ها استفاده شود. رمز، اطلاعات بانکی، مدارک شناسایی و اسرار کاری را وارد نکنید.'],
    ['سقف استفاده رایگان', 'هر کاربر روزانه تعداد محدودی پرامپت رایگان دارد و کل سایت هم سقف روزانه دارد. تلاش برای دور زدن این محدودیت‌ها یا استفاده خودکار و انبوه مجاز نیست.'],
    ['مسئولیت نتیجه', 'پرامپت‌ها توسط هوش مصنوعی ساخته می‌شوند و ممکن است خطا داشته باشند. پیش از استفاده، نتیجه را بررسی کنید. مسئولیت استفاده از خروجی با کاربر است.'],
    ['مالکیت محتوا', 'متن‌ها و پرامپت‌هایی که می‌سازید متعلق به خودتان است.'],
    ['حساب و داده‌ها', 'حساب کاربری و پرامپت‌ها برای همگام‌سازی بین دستگاه‌ها روی سرور پرامپت‌ساز نگه داشته می‌شوند. مسئولیت نگهداری رمز و کد بازیابی با خود شماست. مدیر سایت آمار کلی و فهرست حساب‌ها را می‌بیند، نه متن پرامپت‌ها.'],
  ];
  view.innerHTML = `
    <header class="page-head"><div><h1>قوانین استفاده</h1><p class="muted">با استفاده از پرامپت‌ساز این قوانین را می‌پذیرید.</p></div></header>
    <ol class="rules-list">
      ${rules.map(([title, body]) => `<li><h2>${title}</h2><p>${body}</p></li>`).join('')}
    </ol>
    <p class="muted small rules-links">متن کامل: <a href="terms.html" target="_blank" rel="noopener">شرایط استفاده</a> · <a href="privacy.html" target="_blank" rel="noopener">حریم خصوصی</a></p>`;
}

// ---------- Get the app ----------

function renderApp() {
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  view.innerHTML = `
    <section class="app-page">
      <div class="app-hero">
        ${logoMark('app-hero-logo')}
        <h1>پرامپت‌ساز روی گوشی شما</h1>
        <p class="muted">همه امکانات سایت، به شکل یک اپ مستقل روی صفحه اصلی گوشی.</p>
      </div>
      <div class="app-cards">
        <article class="card app-card ${isAndroid ? 'is-primary' : ''}">
          <h2>${icon('phone')} اندروید</h2>
          <p class="muted">فایل نصبی (APK) را دانلود و نصب کنید. حجم حدود ۴ مگابایت.</p>
          <a class="btn btn-primary btn-pill btn-lg btn-block" id="apk-download" href="${ANDROID_APK_URL}" rel="noopener">${icon('download')} دانلود اپ اندروید</a>
          <p class="app-installed" id="app-installed" hidden>${icon('check')} اپ روی این گوشی نصب است؛ نسخه جدید را خود اپ خبر می‌دهد.</p>
          <ol class="app-steps">
            <li>روی «دانلود اپ اندروید» بزنید.</li>
            <li>فایل <span dir="ltr">promptsaz.apk</span> را باز کنید.</li>
            <li>اگر گوشی پرسید، اجازه «نصب از منابع ناشناس» را برای مرورگر بدهید و «نصب» را بزنید.</li>
          </ol>
          <p class="muted small">نسخه‌های جدید روی همین نسخه نصب می‌شوند و اپ خودش خبر نسخه جدید را می‌دهد. ورود با ایمیل و گوگل در اپ هم در دسترس است. <a href="${ANDROID_RELEASES_URL}" target="_blank" rel="noopener">همه نسخه‌ها</a></p>
        </article>
        <article class="card app-card ${isIOS ? 'is-primary' : ''}">
          <h2>${icon('globe')} آیفون، آیپد و کامپیوتر</h2>
          <p class="muted">نسخه وب را مثل یک اپ روی دستگاه نصب کنید؛ بدون فروشگاه و بدون دانلود.</p>
          <button class="btn btn-soft btn-pill btn-block" id="pwa-install" ${installPrompt ? '' : 'hidden'}>${icon('download')} نصب روی این دستگاه</button>
          <ol class="app-steps">
            <li><strong>آیفون (Safari):</strong> دکمه اشتراک‌گذاری ${icon('upload')} ← «Add to Home Screen».</li>
            <li><strong>Chrome یا Edge:</strong> از منوی مرورگر گزینه «نصب اپ» یا «Install» را بزنید.</li>
          </ol>
        </article>
      </div>
    </section>`;
  if (isAndroid) androidAppInstalled().then((installed) => { if (installed) $('#app-installed')?.removeAttribute('hidden'); });
  $('#pwa-install')?.addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice.catch(() => ({}));
    if (outcome === 'accepted') toast('پرامپت‌ساز روی دستگاه نصب شد', 'success');
    installPrompt = null;
    $('#pwa-install')?.setAttribute('hidden', '');
  });
}

// ---------- Boot ----------

/** Android app (Capacitor): hardware back closes dialogs/drawer, goes back in history, then exits. */
function setupAndroidBack() {
  const appPlugin = window.Capacitor?.Plugins?.App;
  if (!appPlugin?.addListener) return;
  appPlugin.addListener('backButton', () => {
    const openModal = $('.modal-backdrop [data-close]');
    if (openModal) { openModal.click(); return; }
    if (document.body.classList.contains('drawer-open')) { closeDrawer(); return; }
    if (location.hash && location.hash !== '#/studio') history.back();
    else appPlugin.exitApp();
  });
}

async function boot() {
  setupAndroidBack();
  // Rail labels: only when the desktop sidebar is collapsed to icons.
  enableTooltips((el) => el.closest('.sidebar') && document.body.classList.contains('sidebar-closed') && !mobileQuery.matches
    && el.getAttribute('aria-expanded') !== 'true');
  try {
    await auth.restore();
  } catch (err) {
    console.error(err);
    toast('دسترسی به حافظه مرورگر ممکن نیست. حالت ناشناس (Private) را خاموش کنید.', 'error', 8000);
  }
  $('#splash')?.classList.add('hide');
  route();
  sync.start();
  // Prompts pulled from other devices: refresh the sidebar, and list pages unless the user is typing there.
  window.addEventListener('pc:synced', () => {
    if (!auth.currentUser()) return;
    fillRecent(auth.currentUser());
    const { path } = parseHash();
    const typing = document.activeElement?.matches?.('input, textarea, select');
    if (['/history', '/archive'].includes(path) && !typing && !$('.modal-backdrop')) route();
  });
  // Profile changed on another device (name, avatar, admin): redraw the chrome.
  window.addEventListener('pc:auth', () => { renderSidebar(); renderTopbar(); });
  window.addEventListener('pc:session-ended', (e) => {
    studio.result = null;
    toast(e.detail?.message || 'از حساب خارج شدید. دوباره وارد شوید.', 'error', 7000);
    route();
  });
  // After the first render: in the app, offer a newer APK first; then show what changed since the last visit.
  setTimeout(async () => {
    if (google.inAndroidApp()) await updates.checkAppUpdate();
    if (!$('.modal-backdrop')) await updates.maybeShowWhatsNew({ returning: Boolean(auth.currentUser()) });
  }, 600);
}

boot();
