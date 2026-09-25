// Small UI toolkit: escaping, icons, toasts, modals, clipboard, date formatting.

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function $$(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

const ICON_PATHS = {
  sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  pin: '<path d="M9 4h6l-1 6 4 4H6l4-4z"/><path d="M12 14v7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 3"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  star: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  download: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>',
  upload: '<path d="M12 21V9"/><path d="M7 14l5-5 5 5"/><path d="M5 3h14"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  wand: '<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8l1.4 1.4M17.8 6.2l1.4-1.4M12.2 6.2l-1.4-1.4"/><path d="M15 9l-12 12"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3L21 2M16 7l3 3M18 5l2 2"/>',
  camera: '<path d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="4"/>',
  folder: '<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="8" cy="8" r="1.5"/>',
  arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14"/><path d="M12 17h.01"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  volume: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  code: '<path d="M9 8l-4 4 4 4M15 8l4 4-4 4"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  google: '<path d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z" fill="#4285F4" stroke="none"/><path d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z" fill="#34A853" stroke="none"/><path d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1A10 10 0 0 0 2 12c0 1.6.4 3.1 1.1 4.6z" fill="#FBBC05" stroke="none"/><path d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10C7.2 7.7 9.4 6 12 6z" fill="#EA4335" stroke="none"/>',
};

/** The brand mark (same drawing as assets/img/logo.svg), inline so it inherits theme colors. */
export function logoMark(cls = '') {
  return `<svg class="logo-mark ${cls}" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" class="logo-bg"/><path class="logo-bubble" d="M20 13h24a9 9 0 0 1 9 9v15a9 9 0 0 1-9 9h-4l6 8-13-8H20a9 9 0 0 1-9-9V22a9 9 0 0 1 9-9z"/><path class="logo-star" d="M32 18.5c1.2 6.3 4.7 9.8 11 11-6.3 1.2-9.8 4.7-11 11-1.2-6.3-4.7-9.8-11-11 6.3-1.2 9.8-4.7 11-11z"/></svg>`;
}

export function icon(name, cls = '') {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
}

// ---------- Toasts ----------

export function toast(message, type = 'info', timeout = 3200) {
  let host = $('#toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const item = document.createElement('div');
  item.className = `toast toast-${type}`;
  item.innerHTML = `${icon(type === 'error' ? 'info' : type === 'success' ? 'check' : 'info')}<span></span>`;
  item.querySelector('span').textContent = message;
  host.appendChild(item);
  requestAnimationFrame(() => item.classList.add('show'));
  setTimeout(() => {
    item.classList.remove('show');
    item.addEventListener('transitionend', () => item.remove(), { once: true });
    setTimeout(() => item.remove(), 600);
  }, timeout);
}

// ---------- Modal ----------

/**
 * Opens a modal. `body` is trusted HTML built by the caller (escape user data with esc()).
 * Resolves with the value passed to close(), or null when dismissed.
 */
export function modal({ title, body, actions = [], size = '', onMount }) {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal ${size}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header class="modal-head">
          <h2 id="modal-title"></h2>
          <button class="icon-btn" data-close aria-label="بستن">${icon('x')}</button>
        </header>
        <div class="modal-body">${body}</div>
        ${actions.length ? `<footer class="modal-foot">${actions.map((a, i) => `<button class="btn ${a.class || ''}" data-action="${i}" type="${a.submit ? 'submit' : 'button'}">${esc(a.label)}</button>`).join('')}</footer>` : ''}
      </div>`;
    backdrop.querySelector('#modal-title').textContent = title;
    document.body.appendChild(backdrop);
    document.body.classList.add('modal-open');
    requestAnimationFrame(() => backdrop.classList.add('show'));

    const close = (value = null) => {
      backdrop.classList.remove('show');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => {
        backdrop.remove();
        if (!$('.modal-backdrop')) document.body.classList.remove('modal-open');
        previousFocus?.focus?.();
      }, 220);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(null);
    };
    document.addEventListener('keydown', onKey);
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) close(null);
    });
    backdrop.querySelector('[data-close]').addEventListener('click', () => close(null));
    actions.forEach((a, i) => {
      backdrop.querySelector(`[data-action="${i}"]`).addEventListener('click', async () => {
        const result = a.onClick ? await a.onClick(backdrop, close) : a.value;
        if (result !== undefined) close(result);
      });
    });
    onMount?.(backdrop, close);
    const first = backdrop.querySelector('input, textarea, select, button:not([data-close])');
    setTimeout(() => first?.focus(), 60);
  });
}

export function confirmDialog(message, { title = 'تأیید', okLabel = 'تأیید', danger = false } = {}) {
  return modal({
    title,
    body: `<p class="confirm-text">${esc(message)}</p>`,
    size: 'modal-sm',
    actions: [
      { label: 'انصراف', class: 'btn-ghost', value: false },
      { label: okLabel, class: danger ? 'btn-danger' : 'btn-primary', value: true },
    ],
  }).then(Boolean);
}

// ---------- Clipboard ----------

export async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('کپی شد', 'success', 1600);
  if (button) {
    button.classList.add('copied');
    setTimeout(() => button.classList.remove('copied'), 1400);
  }
}

// ---------- Formatting ----------

const dateFmt = new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'long', day: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit' });
const numFmt = new Intl.NumberFormat('fa-IR');

export function formatDate(ts) {
  return `${dateFmt.format(ts)} · ${timeFmt.format(ts)}`;
}

export function relativeTime(ts) {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return 'همین الان';
  if (diff < 3600) return `${numFmt.format(Math.floor(diff / 60))} دقیقه پیش`;
  if (diff < 86400) return `${numFmt.format(Math.floor(diff / 3600))} ساعت پیش`;
  if (diff < 86400 * 7) return `${numFmt.format(Math.floor(diff / 86400))} روز پیش`;
  return dateFmt.format(ts);
}

export function num(n) {
  return numFmt.format(n);
}

/** Escapes text and wraps query term matches in <mark>. Matching is case-insensitive on the raw text. */
export function highlight(text, terms) {
  const safe = esc(text);
  if (!terms?.length) return safe;
  const pattern = terms
    .filter((t) => t.length > 1)
    .map((t) => esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  if (!pattern) return safe;
  return safe.replace(new RegExp(`(${pattern})`, 'gi'), '<mark>$1</mark>');
}

export function truncate(text, max = 220) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export function avatarHtml(user, size = 'md') {
  if (!user) return '';
  if (user.avatar) return `<img class="avatar avatar-${size}" src="${esc(user.avatar)}" alt="" referrerpolicy="no-referrer">`;
  const letters = String(user.name || '?').trim().split(/\s+/).filter(Boolean);
  const text = letters.length > 1 ? letters[0][0] + letters[1][0] : (letters[0] || '?').slice(0, 2);
  return `<span class="avatar avatar-${size}" data-color="${esc(user.color || '#6366f1')}">${esc(text.toUpperCase())}</span>`;
}

/** Applies avatar colors via the CSSOM (keeps the page free of inline style attributes for CSP). */
export function paintAvatars(root = document) {
  $$('.avatar[data-color]', root).forEach((a) => {
    a.style.background = a.dataset.color;
  });
}

export function download(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Tooltips ----------

let tipEl = null;

function hideTooltip() {
  tipEl?.remove();
  tipEl = null;
}

/**
 * Shows `[data-tip]` labels as a fixed tooltip next to the element, on the side facing the page center,
 * clamped inside the viewport. `when(el)` decides whether a tooltip is wanted (e.g. only in the collapsed rail).
 */
export function enableTooltips(when) {
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (!el || !when(el)) { if (!el) hideTooltip(); return; }
    if (tipEl?.dataset.for === el.dataset.tip) return;
    hideTooltip();
    tipEl = document.createElement('div');
    tipEl.className = 'tooltip';
    tipEl.setAttribute('role', 'tooltip');
    tipEl.dataset.for = el.dataset.tip;
    tipEl.textContent = el.dataset.tip;
    document.body.appendChild(tipEl);
    const r = el.getBoundingClientRect();
    const t = tipEl.getBoundingClientRect();
    const gap = 10;
    const toLeft = r.left + r.width / 2 > innerWidth / 2;
    let x = toLeft ? r.left - gap - t.width : r.right + gap;
    let y = r.top + r.height / 2 - t.height / 2;
    x = Math.min(Math.max(8, x), innerWidth - t.width - 8);
    y = Math.min(Math.max(8, y), innerHeight - t.height - 8);
    tipEl.style.left = `${Math.round(x)}px`;
    tipEl.style.top = `${Math.round(y)}px`;
  });
  document.addEventListener('mouseout', (e) => {
    if (!e.relatedTarget || !e.target.closest?.('[data-tip]')?.contains(e.relatedTarget)) hideTooltip();
  });
  ['scroll', 'resize', 'click', 'keydown'].forEach((type) => addEventListener(type, hideTooltip, true));
}
