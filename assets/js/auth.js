// Local accounts: stored in IndexedDB, passwords hashed with PBKDF2 (WebCrypto).
// This protects profiles from casual access on a shared browser; it is not a server-side account.

import * as db from './db.js';

const SESSION_KEY = 'pc.session';
const PBKDF2_ITERATIONS = 210000;
const AVATAR_SIZE = 256;

export const DEFAULT_SETTINGS = Object.freeze({
  apiKey: '',
  model: 'claude-opus-5',
  effort: 'medium',
  defaultLang: 'both',
  defaultType: 'general',
  defaultDetail: 'balanced',
});

const AVATAR_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f97316', '#10b981', '#0ea5e9', '#14b8a6', '#f43f5e'];

let current = null;

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, saltHex) {
  const salt = Uint8Array.from(saltHex.match(/.{2}/g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
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

function persistSession(userId, remember) {
  try {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, userId);
  } catch { /* storage blocked: session lasts for this page load only */ }
}

function readSession() {
  try {
    return localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function currentUser() {
  return current;
}

export function settings() {
  return { ...DEFAULT_SETTINGS, ...(current?.settings || {}) };
}

export async function restore() {
  const id = readSession();
  current = id ? (await db.get('users', id)) || null : null;
  return current;
}

export async function register({ name, email, password, remember = true }) {
  validate({ name, email, password });
  const normalized = normalizeEmail(email);
  if (await db.getByIndex('users', 'email', normalized)) throw new Error('این ایمیل قبلاً در این مرورگر ثبت شده است.');
  const salt = randomSalt();
  const user = {
    id: db.uid(),
    name: String(name).trim(),
    email: normalized,
    salt,
    passHash: await hashPassword(password, salt),
    avatar: null,
    color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
    settings: { ...DEFAULT_SETTINGS },
    createdAt: Date.now(),
  };
  await db.put('users', user);
  current = user;
  persistSession(user.id, remember);
  return user;
}

export async function login({ email, password, remember = true }) {
  const user = await db.getByIndex('users', 'email', normalizeEmail(email));
  if (!user || (await hashPassword(String(password || ''), user.salt)) !== user.passHash) {
    throw new Error('ایمیل یا رمز عبور اشتباه است.');
  }
  current = user;
  persistSession(user.id, remember);
  return user;
}

export function logout() {
  current = null;
  try {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  } catch { /* ignore */ }
}

async function save(patch) {
  if (!current) throw new Error('ابتدا وارد شوید.');
  current = { ...current, ...patch, updatedAt: Date.now() };
  await db.put('users', current);
  return current;
}

export async function updateProfile({ name, email }) {
  validate({ name, email }, { requirePassword: false });
  const normalized = normalizeEmail(email);
  if (normalized !== current.email) {
    const other = await db.getByIndex('users', 'email', normalized);
    if (other && other.id !== current.id) throw new Error('این ایمیل برای حساب دیگری استفاده شده است.');
  }
  return save({ name: String(name).trim(), email: normalized });
}

export async function updateSettings(patch) {
  return save({ settings: { ...settings(), ...patch } });
}

export async function changePassword(oldPassword, newPassword) {
  if ((await hashPassword(String(oldPassword || ''), current.salt)) !== current.passHash) {
    throw new Error('رمز عبور فعلی اشتباه است.');
  }
  validate({ password: newPassword });
  const salt = randomSalt();
  return save({ salt, passHash: await hashPassword(newPassword, salt) });
}

export async function setAvatar(dataUrl) {
  return save({ avatar: dataUrl });
}

export async function deleteAccount(password) {
  if ((await hashPassword(String(password || ''), current.salt)) !== current.passHash) {
    throw new Error('رمز عبور اشتباه است.');
  }
  const prompts = await db.getAllByIndex('prompts', 'userId', current.id);
  await db.removeMany('prompts', prompts.map((p) => p.id));
  await db.remove('users', current.id);
  logout();
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
