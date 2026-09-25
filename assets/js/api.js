// Calls to the account/sync server (the worker at FREE_API_URL) with the session token.

import { FREE_API_URL } from './config.js?v=202609251418';

const TOKEN_KEY = 'pc.token';

export class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function available() {
  return Boolean(FREE_API_URL);
}

export function token() {
  try {
    return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Keeps the token in localStorage ("remember me") or sessionStorage (until the browser closes); null clears it. */
export function setToken(value, remember = true) {
  try {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    if (value) (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, value);
  } catch { /* storage blocked: signed in for this page load only */ }
}

export async function request(method, path, body) {
  if (!FREE_API_URL) throw new ApiError('سرور حساب‌ها راه‌اندازی نشده است.', 'not_configured', 0);
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  const t = token();
  if (t) headers.authorization = `Bearer ${t}`;
  let res;
  try {
    res = await fetch(`${FREE_API_URL.replace(/\/+$/, '')}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError('اتصال به سرور برقرار نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.', 'offline', 0);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.message || `خطای سرور (${res.status}). کمی بعد دوباره تلاش کنید.`, data?.error || 'server', res.status);
  return data;
}
