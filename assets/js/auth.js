// Accounts live on the server (worker/src/store.js); this module keeps a cached copy of the signed-in user in
// IndexedDB so the app opens instantly and keeps working offline. Passwords never leave the browser: they are
// stretched here with PBKDF2 (per-account random salt) and only the result is sent.
// Accounts from before the server (local-only, PBKDF2 hash in IndexedDB) move to the server on their next sign-in,
// together with their prompts.

import * as db from './db.js?v=202609251418';
import * as api from './api.js?v=202609251418';

const SESSION_KEY = 'pc.session'; // id of the signed-in user (cached profile in IndexedDB)
const VIA_KEY = 'pc.via'; // 'password' | 'google': how this session was opened
const PBKDF2_ITERATIONS = 210000;
const AVATAR_SIZE = 256;

export const DEFAULT_SETTINGS = Object.freeze({
  engine: 'free',
  apiKey: '',
  model: 'claude-opus-5',
  effort: 'medium',
  defaultLang: 'both',
  defaultType: 'auto',
  defaultDetail: 'balanced',
});

let current = null;
let pendingRecovery = null; // the code the server issued at registration, shown once

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** PBKDF2-SHA256 of the password; used for the server key and to check pre-server local accounts. */
async function hashPassword(password, saltHex) {
  const salt = Uint8Array.from(saltHex.match(/.{2}/g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, key, 256);
  return toHex(bits);
}

function randomSalt() {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validate({ name, email, password }, { requirePassword = true } = {}) {
  if (name !== undefined && String(name).trim().length < 2) throw new Error('نام باید حداقل ۲ کاراکتر باشد.');
  if (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email))) throw new Error('ایمیل معتبر نیست.');
  if (requirePassword && String(password || '').length < 6) throw new Error('رمز عبور باید حداقل ۶ کاراکتر باشد.');
}

function readStored(key) {
  try {
    return localStorage.getItem(key) || sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function persist(userId, via, remember) {
  try {
    for (const k of [SESSION_KEY, VIA_KEY]) { localStorage.removeItem(k); sessionStorage.removeItem(k); }
    const store = remember ? localStorage : sessionStorage;
    store.setItem(SESSION_KEY, userId);
    store.setItem(VIA_KEY, via);
  } catch { /* storage blocked: signed in for this page load only */ }
}

function announce() {
  window.dispatchEvent(new CustomEvent('pc:auth', { detail: { user: current } }));
}

export function currentUser() {
  return current;
}

export function settings() {
  return { ...DEFAULT_SETTINGS, ...(current?.settings || {}) };
}

/**
 * Opens the cached session instantly, then checks it with the server in the background (profile changes from
 * other devices, blocked or expired sessions). Local sessions from before the server have no token: signed out.
 */
export async function restore() {
  const id = readStored(SESSION_KEY);
  if (!id || !api.token()) { current = null; return null; }
  current = (await db.get('users', id)) || null;
  const check = refresh();
  if (!current) await check;
  return current;
}

/** Re-reads the profile from the server. Signs out on an invalid session; keeps the cache when offline. */
export async function refresh() {
  try {
    const { user } = await api.request('GET', '/me');
    await cacheUser(user);
    announce();
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      signOutLocally();
      announce();
      window.dispatchEvent(new CustomEvent('pc:session-ended', { detail: { message: err.message } }));
    }
  }
  return current;
}

async function cacheUser(user) {
  const cached = await db.get('users', user.id);
  current = { ...user, settings: cached?.settings || current?.settings || { ...DEFAULT_SETTINGS } };
  await db.put('users', current);
  return current;
}

/**
 * Stores a new session from the server. A local account with the same email (from before the server, or an
 * old cache) hands its settings and prompts over to the server account; the prompts are then uploaded by sync.
 */
async function adopt(res, via, remember) {
  api.setToken(res.token, remember);
  const user = res.user;
  const previous = await db.getByIndex('users', 'email', user.email);
  const cached = await db.get('users', user.id);
  let carried = cached?.settings;
  if (previous && previous.id !== user.id) {
    carried ||= previous.settings;
    const rows = await db.getAllByIndex('prompts', 'userId', previous.id);
    if (rows.length) await db.putMany('prompts', rows.map((r) => ({ ...r, userId: user.id, dirty: true, updatedAt: Math.max(Number(r.updatedAt) || 0, Number(r.createdAt) || 0, 1) })));
    await db.remove('users', previous.id);
  }
  current = { ...user, settings: { ...DEFAULT_SETTINGS, ...(carried || {}) } };
  await db.put('users', current);
  persist(user.id, via, remember);
  announce();
  return current;
}

/** A pre-server local account for this email, if this browser has one. */
async function legacyAccount(email) {
  const user = await db.getByIndex('users', 'email', normalizeEmail(email));
  return user && (user.passHash || user.googleSub) && !user.hasPassword && user.salt !== undefined ? user : null;
}

export async function register({ name, email, password, remember = true, avatar }) {
  validate({ name, email, password });
  const clientSalt = randomSalt();
  const key = await hashPassword(password, clientSalt);
  const legacy = await legacyAccount(email);
  const res = await api.request('POST', '/auth/register', {
    name: String(name).trim(),
    email: normalizeEmail(email),
    clientSalt,
    key,
    avatar: avatar ?? (legacy?.avatar?.startsWith('data:') ? legacy.avatar : null),
    remember,
  });
  pendingRecovery = res.recoveryCode;
  return adopt(res, 'password', remember);
}

/** Whether an account exists for this email (drives the email-first sign-in step). */
export async function lookupAccount(email) {
  const info = await api.request('POST', '/auth/lookup', { email: normalizeEmail(email) });
  if (info.exists) return { exists: true, hasPassword: info.hasPassword };
  const legacy = await legacyAccount(email);
  return { exists: Boolean(legacy?.passHash), hasPassword: Boolean(legacy?.passHash) };
}

export async function login({ email, password, remember = true }) {
  const e = normalizeEmail(email);
  const info = await api.request('POST', '/auth/lookup', { email: e });
  if (!info.exists) {
    // First sign-in since accounts moved to the server: check the old local password, then create the account.
    const legacy = await legacyAccount(e);
    if (legacy?.passHash && (await hashPassword(String(password || ''), legacy.salt)) === legacy.passHash) {
      return { ...(await register({ name: legacy.name, email: e, password, remember })), migrated: true };
    }
    throw new Error('ایمیل یا رمز عبور اشتباه است.');
  }
  if (!info.hasPassword) throw new Error('این حساب با گوگل ساخته شده است؛ با دکمه «ادامه با گوگل» وارد شوید.');
  const res = await api.request('POST', '/auth/login', { email: e, key: await hashPassword(String(password || ''), info.clientSalt), remember });
  return adopt(res, 'password', remember);
}

/**
 * Signs in with a Google ID token (the server verifies Google's signature). The returned user carries
 * `passwordRemoved` when an unverified password on the same email was dropped for safety.
 */
export async function loginWithGoogle(credential, { remember = true } = {}) {
  const res = await api.request('POST', '/auth/google', { credential, remember });
  const user = await adopt(res, 'google', remember);
  return { ...user, passwordRemoved: Boolean(res.passwordRemoved) };
}

/** Resets a forgotten password with the recovery code; signs in and returns a fresh recovery code. */
export async function resetPassword({ email, code, password, remember = true }) {
  validate({ password });
  const e = normalizeEmail(email);
  const info = await api.request('POST', '/auth/lookup', { email: e });
  if (!info.exists) throw new Error('ایمیل یا کد بازیابی اشتباه است.');
  const res = await api.request('POST', '/auth/reset', { email: e, code, key: await hashPassword(password, info.clientSalt), remember });
  await adopt(res, 'password', remember);
  return res.recoveryCode;
}

/** Returns the registration code once, otherwise creates a new one (the previous code stops working). */
export async function createRecoveryCode() {
  if (pendingRecovery) {
    const code = pendingRecovery;
    pendingRecovery = null;
    return code;
  }
  const res = await api.request('POST', '/me/recovery');
  await cacheUser(res.user);
  return res.recoveryCode;
}

export function hasRecoveryCode() {
  return Boolean(current?.hasRecovery);
}

export function hasPassword() {
  return Boolean(current?.hasPassword);
}

export function isAdmin() {
  return Boolean(current?.admin);
}

/** Whether changing the password needs the old one (not for Google-only accounts or a Google-opened session). */
export function needsOldPassword() {
  return Boolean(current?.hasPassword) && readStored(VIA_KEY) !== 'google';
}

function signOutLocally() {
  current = null;
  pendingRecovery = null;
  api.setToken(null);
  try {
    for (const k of [SESSION_KEY, VIA_KEY]) { localStorage.removeItem(k); sessionStorage.removeItem(k); }
  } catch { /* ignore */ }
}

export function logout() {
  if (api.token()) api.request('POST', '/auth/logout').catch(() => {});
  signOutLocally();
  announce();
}

async function saveProfile(patch) {
  if (!current) throw new Error('ابتدا وارد شوید.');
  const { user } = await api.request('POST', '/me', patch);
  await cacheUser(user);
  announce();
  return current;
}

export async function updateProfile({ name, email }) {
  validate({ name, email }, { requirePassword: false });
  return saveProfile({ name: String(name).trim(), email: normalizeEmail(email) });
}

export async function setAvatar(dataUrl) {
  return saveProfile({ avatar: dataUrl || null });
}

/** Settings (engine, API key, defaults) stay on this device; the API key is never sent to our server. */
export async function updateSettings(patch) {
  if (!current) throw new Error('ابتدا وارد شوید.');
  current = { ...current, settings: { ...settings(), ...patch } };
  await db.put('users', current);
  return current;
}

async function clientSalt() {
  const info = await api.request('POST', '/auth/lookup', { email: current.email });
  if (!info.clientSalt) throw new Error('حساب پیدا نشد.');
  return info.clientSalt;
}

export async function changePassword(oldPassword, newPassword) {
  validate({ password: newPassword });
  const salt = await clientSalt();
  const body = { key: await hashPassword(newPassword, salt) };
  if (needsOldPassword()) body.oldKey = await hashPassword(String(oldPassword || ''), salt);
  const { user } = await api.request('POST', '/me/password', body);
  await cacheUser(user);
  return current;
}

/** `confirmation` is the password, or the account email for Google-only accounts. Removes it everywhere. */
export async function deleteAccount(confirmation) {
  const body = current.hasPassword
    ? { key: await hashPassword(String(confirmation || ''), await clientSalt()) }
    : { email: normalizeEmail(confirmation) };
  await api.request('POST', '/me/delete', body);
  const rows = await db.getAllByIndex('prompts', 'userId', current.id);
  await db.removeMany('prompts', rows.map((p) => p.id));
  await db.remove('users', current.id);
  signOutLocally();
  announce();
}

/** Center-crops and re-encodes an uploaded image to a small square (drops any embedded payload). */
export async function imageFileToAvatar(file) {
  if (!file || !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('فقط تصویر PNG، JPG، WEBP یا GIF مجاز است.');
  if (file.size > 5 * 1024 * 1024) throw new Error('حجم تصویر باید کمتر از ۵ مگابایت باشد.');
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('تصویر قابل خواندن نیست.');
  });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bitmap.close?.();
  const webp = canvas.toDataURL('image/webp', 0.88);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] || '?').slice(0, 2)).toUpperCase();
}
