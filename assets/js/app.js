// Prompt Creator — single-page app shell, hash router and views.

import * as auth from './auth.js';
import * as prompts from './prompts.js';
import * as engine from './engine.js';
import * as google from './google.js';
import {
  $, $$, esc, icon, toast, modal, confirmDialog, copyText, formatDate, relativeTime, num,
  highlight, truncate, avatarHtml, paintAvatars, download,
} from './ui.js';

const view = $('#view');
const DRAFT_KEY = 'pc.draft';
const THEME_KEY = 'pc.theme';

// Studio state survives navigation within the session.
const studio = {
  result: null, // saved prompt record of the latest generation
  busy: false,
  controller: null,
  startedAt: 0,
  timer: null,
};

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
  renderChrome();
}

try { applyTheme(localStorage.getItem(THEME_KEY)); } catch { /* ignore */ }

// ---------- Router ----------

// Every page except the studio needs an account; the studio (home) is open to guests.
const ROUTES = {
  '/studio': { render: renderStudio, title: 'ساخت پرامپت', auth: false },
  '/history': { render: renderHistory, title: 'تاریخچه', auth: true },
  '/archive': { render: renderArchive, title: 'آرشیو', auth: true },
  '/profile': { render: renderProfile, title: 'حساب کاربری', auth: true },
  '/settings': { render: renderSettings, title: 'تنظیمات', auth: true },
};

const AUTH_REASONS = {
  '/history': 'برای دیدن تاریخچه پرامپت‌هایتان وارد شوید.',
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
  if (blocked) target = '/studio';
  if (target !== path) {
    history.replaceState(null, '', `#${target}`);
  }
  document.title = `${ROUTES[target].title} · Prompt Creator`;
  renderChrome(target);
  view.classList.remove('view-enter');
  void view.offsetWidth; // restart the enter animation
  view.classList.add('view-enter');
  try {
    await ROUTES[target].render(params);
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="empty">${icon('info', 'icon-lg')}<p>${esc(err.message || 'خطا در نمایش صفحه')}</p></div>`;
  }
  view.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
  if (blocked && ROUTES[path]) {
    if (await openAuthModal({ reason: AUTH_REASONS[path] })) navigate(path);
  }
}

window.addEventListener('hashchange', route);

// ---------- Chrome (sidebar, mobile nav) ----------

const NAV = [
  { path: '/studio', label: 'ساخت پرامپت', short: 'ساخت', icon: 'sparkles' },
  { path: '/history', label: 'تاریخچه', icon: 'history' },
  { path: '/archive', label: 'آرشیو', icon: 'archive' },
  { path: '/settings', label: 'تنظیمات', icon: 'settings' },
];

function renderChrome(active = parseHash().path) {
  const user = auth.currentUser();
  const sidebar = $('#sidebar');
  const bottom = $('#bottom-nav');
  const links = NAV.map((n) => `
    <a href="#${n.path}" class="nav-link ${active === n.path ? 'active' : ''}" ${active === n.path ? 'aria-current="page"' : ''}>
      ${icon(n.icon)}<span>${n.label}</span>
    </a>`).join('');
  const account = user
    ? `<a href="#/profile" class="user-chip ${active === '/profile' ? 'active' : ''}">
        ${avatarHtml(user, 'sm')}
        <span class="user-meta"><strong>${esc(user.name)}</strong><small>${esc(user.email)}</small></span>
      </a>`
    : `<button class="btn btn-primary btn-block" data-login>${icon('user')}<span>ورود / ثبت‌نام</span></button>`;
  sidebar.innerHTML = `
    <a class="brand" href="#/studio" aria-label="Prompt Creator">
      <span class="brand-mark">${icon('wand')}</span>
      <span class="brand-text">Prompt Creator<small>سازنده پرامپت حرفه‌ای</small></span>
    </a>
    <nav class="nav" aria-label="منوی اصلی">${links}</nav>
    <div class="sidebar-foot">
      <button class="icon-btn" id="theme-toggle" aria-label="تغییر تم" title="تغییر تم">${icon(currentTheme() === 'dark' ? 'sun' : 'moon')}</button>
      ${account}
    </div>`;
  bottom.innerHTML = `${NAV.map((n) => `
    <a href="#${n.path}" class="${active === n.path ? 'active' : ''}" aria-label="${n.label}">${icon(n.icon)}<span>${n.short || n.label}</span></a>`).join('')}
    ${user
      ? `<a href="#/profile" class="${active === '/profile' ? 'active' : ''}" aria-label="حساب کاربری">${avatarHtml(user, 'xs')}<span>حساب</span></a>`
      : `<button type="button" data-login aria-label="ورود">${icon('user')}<span>ورود</span></button>`}`;
  $('#theme-toggle').addEventListener('click', toggleTheme);
  $$('[data-login]').forEach((b) => b.addEventListener('click', () => openAuthModal()));
  paintAvatars(sidebar);
  paintAvatars(bottom);
}

// ---------- Auth modal ----------

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
      $('#save-code', root).addEventListener('click', () => download('promptcreator-recovery-code.txt', `Prompt Creator\n${auth.currentUser()?.email || ''}\nRecovery code: ${code}\n`, 'text/plain'));
    },
  });
}

/**
 * Opens the sign-in / sign-up dialog. Resolves true once the user is signed in, false if dismissed.
 * The current page is re-rendered after a successful sign-in.
 */
function openAuthModal({ mode = 'login', reason = '' } = {}) {
  if (authOpen) return authOpen;
  let signedIn = false;
  let recoveryCode = null;
  authOpen = modal({
    title: 'ورود به Prompt Creator',
    size: 'modal-auth',
    body: `
      <div class="auth-dialog">
        <div class="auth-intro">
          <span class="brand-mark">${icon('wand')}</span>
          <p>${esc(reason || 'برای ساخت و ذخیره پرامپت‌ها وارد حساب خود شوید یا در چند ثانیه حساب بسازید.')}</p>
        </div>
        ${google.enabled() ? `
          <div class="google-slot" id="google-slot"><div class="skeleton google-skeleton"></div></div>
          <div class="divider"><span>یا با ایمیل</span></div>` : ''}
        <div class="tabs auth-tabs" role="tablist">
          <button type="button" role="tab" class="tab ${mode === 'login' ? 'active' : ''}" data-mode="login">ورود</button>
          <button type="button" role="tab" class="tab ${mode === 'register' ? 'active' : ''}" data-mode="register">ثبت‌نام</button>
        </div>
        <form id="auth-form" novalidate>
          <label class="field" data-only="register"><span>نام</span>
            <input name="name" autocomplete="name" minlength="2" placeholder="مثلاً رسول"></label>
          <label class="field"><span>ایمیل</span>
            <input name="email" type="email" dir="ltr" autocomplete="email" required placeholder="you@example.com"></label>
          <label class="field" data-only="forgot"><span>کد بازیابی</span>
            <input name="code" dir="ltr" autocomplete="off" spellcheck="false" placeholder="XXXX-XXXX-XXXX"></label>
          <label class="field"><span data-label="password">رمز عبور</span>
            <input name="password" type="password" dir="ltr" autocomplete="current-password" required minlength="6" placeholder="حداقل ۶ کاراکتر"></label>
          <div class="auth-row">
            <label class="check"><input type="checkbox" name="remember" checked><span>مرا به خاطر بسپار</span></label>
            <button type="button" class="link-btn" data-only="login" id="forgot-link">رمز را فراموش کرده‌اید؟</button>
          </div>
          <p class="auth-hint" data-only="forgot">${icon('info')} کد بازیابی هنگام ثبت‌نام به شما داده شده است. ${google.enabled() ? 'اگر ایمیل حسابتان همان ایمیل گوگل است، می‌توانید با «ادامه با گوگل» وارد شوید و از صفحه حساب کاربری رمز جدید بگذارید.' : ''}</p>
          <p class="form-error" role="alert" hidden></p>
          <button class="btn btn-primary btn-block" type="submit"></button>
        </form>
        <p class="auth-note">${icon('info')} حساب و اطلاعات شما فقط در همین مرورگر ذخیره می‌شود. برای انتقال به دستگاه دیگر از «پشتیبان‌گیری» در تنظیمات استفاده کنید.</p>
      </div>`,
    onMount: (root, close) => {
      const form = $('#auth-form', root);
      const errorBox = $('.form-error', form);
      const submit = $('button[type=submit]', form);
      let current = mode;

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
      const setMode = (m) => {
        current = m;
        $$('.auth-tabs .tab', root).forEach((t) => t.classList.toggle('active', t.dataset.mode === m));
        $$('[data-only]', form).forEach((el) => { el.hidden = el.dataset.only !== m; });
        $('input[name=name]', form).required = m === 'register';
        $('input[name=code]', form).required = m === 'forgot';
        $('input[name=password]', form).autocomplete = m === 'login' ? 'current-password' : 'new-password';
        $('[data-label=password]', form).textContent = m === 'forgot' ? 'رمز عبور جدید' : 'رمز عبور';
        submit.textContent = { login: 'ورود', register: 'ساخت حساب', forgot: 'تعیین رمز جدید و ورود' }[m];
        errorBox.hidden = true;
      };
      setMode(mode);
      $$('.auth-tabs .tab', root).forEach((t) => t.addEventListener('click', () => setMode(t.dataset.mode)));
      $('#forgot-link', form).addEventListener('click', () => setMode('forgot'));

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form));
        errorBox.hidden = true;
        submit.disabled = true;
        submit.classList.add('loading');
        try {
          const payload = { ...data, remember: Boolean(data.remember) };
          if (current === 'forgot') {
            recoveryCode = { code: await auth.resetPassword(payload), fresh: false };
            toast('رمز عبور جدید ثبت شد', 'success');
            signedIn = true;
            close(true);
            return;
          }
          const user = current === 'register' ? await auth.register(payload) : await auth.login(payload);
          if (current === 'register') recoveryCode = { code: await auth.createRecoveryCode(), fresh: true };
          done(user, current === 'register');
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
            const user = await auth.loginWithGoogle(google.parseCredential(credential), { remember: Boolean($('input[name=remember]', form).checked) });
            done(user, !existed && Date.now() - user.createdAt < 5000);
          } catch (err) {
            showError(err.message);
          }
        }, { theme: currentTheme() }).catch((err) => {
          slot.innerHTML = `<p class="muted small"></p>`;
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

// ---------- Studio ----------

function optionGroup(name, options, selected) {
  return `<div class="segmented" role="radiogroup" data-name="${name}">
    ${Object.entries(options).map(([value, label]) => `
      <label class="seg ${value === selected ? 'active' : ''}">
        <input type="radio" name="${name}" value="${value}" ${value === selected ? 'checked' : ''}>
        <span>${esc(typeof label === 'string' ? label : label.label)}</span>
      </label>`).join('')}
  </div>`;
}

function readDraft() {
  try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); } catch { return null; }
}

function saveDraft(draft) {
  try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* ignore */ }
}

function renderStudio() {
  const s = auth.settings();
  const draft = readDraft() || { source: '', type: s.defaultType, lang: s.defaultLang, detail: s.defaultDetail };
  const user = auth.currentUser();

  view.innerHTML = `
    ${user ? `
    <header class="page-head">
      <div>
        <h1>سلام ${esc(String(user.name).split(/\s+/)[0])} 👋</h1>
        <p class="muted">ایده، درخواست یا پرامپت خامتان را بنویسید تا به یک پرامپت حرفه‌ای تبدیل شود.</p>
      </div>
    </header>` : `
    <header class="hero">
      <span class="brand-mark brand-mark-lg">${icon('wand')}</span>
      <h1>چه پرامپتی می‌خواهید بسازید؟</h1>
      <p class="muted">ایده‌ی خامتان را به فارسی یا انگلیسی بنویسید؛ پرامپتی حرفه‌ای با ادبیات هوش مصنوعی به هر دو زبان تحویل بگیرید.</p>
      <ul class="hero-points">
        <li>${icon('sparkles')} بازنویسی و ترجمه فارسی ⇄ انگلیسی</li>
        <li>${icon('history')} ذخیره خودکار در تاریخچه</li>
        <li>${icon('archive')} آرشیو با جستجوی پیشرفته</li>
      </ul>
    </header>`}
    ${!user || s.apiKey ? '' : `
      <div class="banner">${icon('key')}
        <div><strong>کلید API هنوز تنظیم نشده است.</strong>
        <span>برای ساخت پرامپت، کلید API خود از Anthropic را در تنظیمات وارد کنید.</span></div>
        <a class="btn btn-sm btn-primary" href="#/settings">رفتن به تنظیمات</a>
      </div>`}
    <section class="studio">
      <form class="card composer" id="composer">
        <div class="composer-input">
          <textarea id="source" name="source" dir="auto" rows="7" maxlength="20000"
            placeholder="مثلاً: یک پرامپت برای ساخت لوگوی مینیمال یک کافه با رنگ‌های گرم می‌خواهم…">${esc(draft.source)}</textarea>
          <div class="composer-meta">
            <span id="char-count">${num(draft.source.length)} کاراکتر</span>
            <span class="kbd-hint"><kbd>Ctrl</kbd> + <kbd>Enter</kbd> برای ساخت</span>
          </div>
        </div>
        <div class="options">
          <div class="option-row">
            <span class="option-label">نوع پرامپت</span>
            ${optionGroup('type', engine.TARGETS, draft.type)}
          </div>
          <div class="option-grid">
            <div class="option-row">
              <span class="option-label">زبان خروجی</span>
              ${optionGroup('lang', engine.LANGS, draft.lang)}
            </div>
            <div class="option-row">
              <span class="option-label">میزان جزئیات</span>
              ${optionGroup('detail', engine.DETAILS, draft.detail)}
            </div>
          </div>
        </div>
        <div class="composer-actions">
          <button type="button" class="btn btn-ghost" id="clear-btn">${icon('x')} پاک کردن</button>
          <button type="submit" class="btn btn-primary btn-lg" id="generate-btn">${icon('sparkles')}<span>ساخت پرامپت</span></button>
        </div>
      </form>
      <div id="result"></div>
    </section>`;

  const form = $('#composer');
  const source = $('#source');
  const autoGrow = () => {
    source.style.height = 'auto';
    source.style.height = `${Math.min(source.scrollHeight + 2, 520)}px`;
  };
  const persist = () => {
    const data = Object.fromEntries(new FormData(form));
    saveDraft({ source: data.source, type: data.type, lang: data.lang, detail: data.detail });
  };

  source.addEventListener('input', () => {
    $('#char-count').textContent = `${num(source.value.length)} کاراکتر`;
    autoGrow();
    persist();
  });
  source.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  $$('.segmented', form).forEach((group) => {
    group.addEventListener('change', (e) => {
      $$('.seg', group).forEach((seg) => seg.classList.toggle('active', seg.contains(e.target)));
      persist();
    });
  });
  $('#clear-btn').addEventListener('click', () => {
    source.value = '';
    source.dispatchEvent(new Event('input'));
    source.focus();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (studio.busy) cancelGeneration();
    else runGeneration();
  });

  requestAnimationFrame(autoGrow);
  if (studio.busy) showLoading();
  else if (studio.result) showResult(studio.result);
}

function setBusy(busy) {
  studio.busy = busy;
  const btn = $('#generate-btn');
  if (!btn) return;
  btn.classList.toggle('btn-danger', busy);
  btn.classList.toggle('btn-primary', !busy);
  btn.innerHTML = busy ? `${icon('stop')}<span>توقف</span>` : `${icon('sparkles')}<span>ساخت پرامپت</span>`;
}

function showLoading() {
  const box = $('#result');
  if (!box) return;
  box.innerHTML = `
    <div class="card result loading-card" aria-busy="true">
      <div class="thinking"><span class="orb"></span><strong>در حال ساخت پرامپت…</strong><span class="muted" id="elapsed"></span></div>
      <div class="skeleton w-40"></div>
      <div class="skeleton"></div><div class="skeleton"></div><div class="skeleton w-80"></div>
      <div class="skeleton"></div><div class="skeleton w-60"></div>
    </div>`;
  setBusy(true);
  const tick = () => {
    const el = $('#elapsed');
    if (el) el.textContent = `${num(Math.floor((Date.now() - studio.startedAt) / 1000))} ثانیه`;
  };
  tick();
  clearInterval(studio.timer);
  studio.timer = setInterval(tick, 1000);
}

function cancelGeneration() {
  studio.controller?.abort();
}

async function runGeneration() {
  const form = $('#composer');
  const data = Object.fromEntries(new FormData(form));
  const text = data.source.trim();
  if (!text) {
    toast('ابتدا متنی بنویسید', 'error');
    $('#source').focus();
    return;
  }
  if (!auth.currentUser()) {
    // Guests can write freely; signing in is asked for only when they generate. The draft is kept.
    if (!(await openAuthModal({ reason: 'برای ساخت پرامپت و ذخیره آن در تاریخچه، وارد شوید یا حساب بسازید.' }))) return;
  }
  const s = auth.settings();
  if (!s.apiKey) {
    toast('ابتدا کلید API را در تنظیمات وارد کنید', 'error');
    navigate('/settings');
    return;
  }
  const options = { type: data.type, lang: data.lang, detail: data.detail };
  studio.controller = new AbortController();
  studio.startedAt = Date.now();
  studio.result = null;
  showLoading();
  $('#result')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

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
    if ($('#result')) showResult(record, true);
    toast('پرامپت ساخته و در تاریخچه ذخیره شد', 'success');
  } catch (err) {
    const box = $('#result');
    if (box && err.code !== 'aborted') {
      box.innerHTML = `<div class="card result error-card">${icon('info', 'icon-lg')}<div><strong>ساخت پرامپت انجام نشد</strong><p></p></div></div>`;
      $('p', box).textContent = err.message;
    } else if (box) {
      box.innerHTML = '';
    }
    if (err.code === 'aborted') toast('لغو شد');
    else toast(err.message, 'error', 5000);
  } finally {
    clearInterval(studio.timer);
    studio.controller = null;
    setBusy(false);
  }
}

function promptBlock(label, text, lang) {
  if (!text) return '';
  const dir = lang === 'fa' ? 'rtl' : 'ltr';
  return `
    <div class="prompt-block" data-lang="${lang}">
      <div class="prompt-block-head">
        <span class="lang-pill">${label}</span>
        <button class="btn btn-sm btn-ghost copy-btn" data-copy="${lang}">${icon('copy')}<span>کپی</span></button>
      </div>
      <pre class="prompt-text" dir="${dir}" lang="${lang}">${esc(text)}</pre>
    </div>`;
}

function showResult(record, animate = false) {
  const box = $('#result');
  if (!box) return;
  const both = record.promptEn && record.promptFa;
  box.innerHTML = `
    <article class="card result ${animate ? 'pop-in' : ''}">
      <header class="result-head">
        <div>
          <h2 dir="auto"></h2>
          <p class="muted small">${esc(engine.TARGETS[record.type]?.label || '')} · ${esc(engine.DETAILS[record.detail] || '')} · ${esc(record.model)}</p>
        </div>
        <div class="result-actions">
          <button class="btn btn-sm btn-ghost" id="refine-btn" title="استفاده از نتیجه به‌عنوان ورودی جدید">${icon('refresh')}<span>بهبود دوباره</span></button>
          <button class="btn btn-sm ${record.archived ? 'btn-soft' : 'btn-primary'}" id="archive-btn">${icon('archive')}<span>${record.archived ? 'در آرشیو' : 'ذخیره در آرشیو'}</span></button>
        </div>
      </header>
      ${both ? `
        <div class="tabs" role="tablist">
          <button role="tab" class="tab active" data-tab="both" aria-selected="true">هر دو</button>
          <button role="tab" class="tab" data-tab="en" aria-selected="false">English</button>
          <button role="tab" class="tab" data-tab="fa" aria-selected="false">فارسی</button>
        </div>` : ''}
      <div class="prompt-blocks ${both ? 'two' : ''}">
        ${promptBlock('English', record.promptEn, 'en')}
        ${promptBlock('فارسی', record.promptFa, 'fa')}
      </div>
      ${record.improvements?.length ? `
        <div class="improvements">
          <strong>${icon('sparkles')} بهبودهای انجام‌شده</strong>
          <ul>${record.improvements.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
        </div>` : ''}
    </article>`;
  $('h2', box).textContent = record.title || 'پرامپت جدید';

  $$('.copy-btn', box).forEach((b) => b.addEventListener('click', () => copyText(b.dataset.copy === 'fa' ? record.promptFa : record.promptEn, b)));
  $$('.tab', box).forEach((tab) => tab.addEventListener('click', () => {
    $$('.tab', box).forEach((t) => {
      t.classList.toggle('active', t === tab);
      t.setAttribute('aria-selected', String(t === tab));
    });
    $$('.prompt-block', box).forEach((b) => {
      b.hidden = tab.dataset.tab !== 'both' && b.dataset.lang !== tab.dataset.tab;
    });
    $('.prompt-blocks', box).classList.toggle('two', tab.dataset.tab === 'both');
  }));
  $('#archive-btn').addEventListener('click', async () => {
    const saved = await openArchiveDialog(record);
    if (saved) {
      studio.result = saved;
      showResult(saved);
    }
  });
  $('#refine-btn').addEventListener('click', () => {
    const source = $('#source');
    source.value = record.promptEn || record.promptFa;
    source.dispatchEvent(new Event('input'));
    source.focus();
    source.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
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
          ${promptBlock('English', record.promptEn, 'en')}
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
  saveDraft({ source: record.source, type: record.type, lang: record.lang, detail: record.detail });
  studio.result = record;
  navigate('/studio');
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

/** Keeps filters in the URL (bookmarkable) without triggering a re-route. */
function syncQuery(values) {
  const { path } = parseHash();
  const params = new URLSearchParams();
  Object.entries(values).forEach(([k, v]) => { if (v) params.set(k, v); });
  const qs = params.toString();
  history.replaceState(null, '', `#${path}${qs ? `?${qs}` : ''}`);
}

function staggerCards(root) {
  $$('.prompt-card', root).forEach((card, i) => {
    card.style.animationDelay = `${Math.min(i, 12) * 35}ms`;
    card.classList.add('card-enter');
  });
}

// ---------- Archive ----------

const ARCHIVE_FILTERS = ['q', 'category', 'tag', 'type', 'lang', 'favorite', 'from', 'to', 'sort'];

async function renderArchive(params) {
  const user = auth.currentUser();
  const all = await prompts.listForUser(user.id);
  const rows = all.filter((r) => r.archived);
  const f = Object.fromEntries(ARCHIVE_FILTERS.map((k) => [k, params.get(k) || '']));
  const { categories, tags } = prompts.facets(rows);
  const advancedOpen = Boolean(f.category || f.type || f.lang || f.from || f.to || f.favorite || (f.sort && f.sort !== 'newest'));

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
          <label class="field"><span>از تاریخ</span><input type="date" name="from" value="${esc(f.from)}"></label>
          <label class="field"><span>تا تاریخ</span><input type="date" name="to" value="${esc(f.to)}"></label>
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
    const found = prompts.search(rows, { ...current, favorite: Boolean(current.favorite) });
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
      <p class="muted">حساب و همه پرامپت‌های آن برای همیشه از این مرورگر حذف می‌شود. پیش از آن از تنظیمات پشتیبان بگیرید.</p>
      <button class="btn btn-danger btn-sm" id="delete-account">حذف حساب</button>
    </section>`;
  $('.profile-id h2').textContent = user.name;
  $('.profile-id p').textContent = user.email;
  paintAvatars(view);

  $('#logout-btn').addEventListener('click', () => {
    auth.logout();
    studio.result = null;
    toast('از حساب خارج شدید');
    navigate('/studio');
  });
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
    <header class="page-head"><div><h1>تنظیمات</h1><p class="muted">اتصال به Claude، پیش‌فرض‌ها، ظاهر و پشتیبان‌گیری.</p></div></header>
    <form class="card" id="api-form">
      <h2 class="card-title">${icon('key')} اتصال به Claude</h2>
      <p class="muted small">برای ساخت پرامپت به یک کلید API از <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a> نیاز دارید. کلید فقط در همین مرورگر ذخیره می‌شود و مستقیماً به سرور Anthropic فرستاده می‌شود.</p>
      <label class="field"><span>کلید API</span>
        <div class="input-group">
          <input name="apiKey" id="api-key" type="password" dir="ltr" autocomplete="off" spellcheck="false" placeholder="sk-ant-..." value="${esc(s.apiKey)}">
          <button type="button" class="btn btn-ghost btn-sm" id="toggle-key">نمایش</button>
        </div>
      </label>
      <div class="grid-2 tight">
        <label class="field"><span>مدل</span>
          <select name="model">${engine.MODELS.map((m) => `<option value="${m.id}" ${m.id === s.model ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>
        <label class="field"><span>عمق فکر کردن (Effort)</span>
          <select name="effort">
            ${[['low', 'کم — سریع‌تر'], ['medium', 'متوسط — پیشنهادی'], ['high', 'زیاد — دقیق‌تر'], ['xhigh', 'خیلی زیاد']].map(([v, l]) => `<option value="${v}" ${v === s.effort ? 'selected' : ''}>${l}</option>`).join('')}
          </select></label>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="test-key">آزمایش اتصال</button>
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
  $('#toggle-key').addEventListener('click', (e) => {
    const show = keyInput.type === 'password';
    keyInput.type = show ? 'text' : 'password';
    e.currentTarget.textContent = show ? 'پنهان' : 'نمایش';
  });
  $('#api-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    await auth.updateSettings({ apiKey: data.apiKey.trim(), model: data.model, effort: data.effort });
    toast('تنظیمات اتصال ذخیره شد', 'success');
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
    renderChrome();
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

// ---------- Boot ----------

async function boot() {
  try {
    await auth.restore();
  } catch (err) {
    console.error(err);
    toast('دسترسی به حافظه مرورگر ممکن نیست. حالت ناشناس (Private) را خاموش کنید.', 'error', 8000);
  }
  $('#splash')?.classList.add('hide');
  route();
}

boot();
