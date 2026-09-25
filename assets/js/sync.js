// Keeps this device's prompts in step with the account server (worker POST /sync).
// Push: every record marked `dirty` (in batches). Pull: everything changed on the server since the last cursor.
// Conflicts: the newer `updatedAt` wins; a local edit newer than the server copy is kept and uploaded.
// Runs after sign-in, after local changes (debounced), when the tab becomes visible, and every minute.

import * as db from './db.js?v=202609251532';
import * as api from './api.js?v=202609251532';
import * as auth from './auth.js?v=202609251532';

const BATCH_RECORDS = 100;
const BATCH_BYTES = 1_500_000;
const cursorKey = (userId) => `pc.sync.${userId}`;

let running = false;
let again = false;
let timer = null;
let failures = 0;

function readCursor(userId) {
  try { return Number(localStorage.getItem(cursorKey(userId)) || 0); } catch { return 0; }
}

function writeCursor(userId, cursor) {
  try { localStorage.setItem(cursorKey(userId), String(cursor)); } catch { /* ignore */ }
}

/** Fields that only exist on this device. */
function forServer(row) {
  const { userId, dirty, syncError, ...rest } = row;
  return rest;
}

function takeBatch(rows) {
  const batch = [];
  let bytes = 0;
  for (const row of rows) {
    const size = JSON.stringify(row).length;
    if (batch.length && (batch.length >= BATCH_RECORDS || bytes + size > BATCH_BYTES)) break;
    batch.push(row);
    bytes += size;
  }
  return batch;
}

export function schedule(delay = 800) {
  clearTimeout(timer);
  timer = setTimeout(run, delay);
}

export async function run() {
  const user = auth.currentUser();
  if (!user || !api.token() || !api.available()) return;
  if (running) { again = true; return; }
  running = true;
  let pulled = false;
  try {
    let cursor = readCursor(user.id);
    let pending = (await db.getAllByIndex('prompts', 'userId', user.id)).filter((r) => r.dirty);
    let more = true;
    while (pending.length || more) {
      const batch = takeBatch(pending);
      pending = pending.slice(batch.length);
      const res = await api.request('POST', '/sync', { since: cursor, changes: batch.map(forServer) });
      if (auth.currentUser()?.id !== user.id) return; // signed out meanwhile
      const rejected = new Set(res.rejected || []);
      for (const sent of batch) {
        const now = await db.get('prompts', sent.id);
        if (!now || now.updatedAt !== sent.updatedAt) continue; // edited again meanwhile: stays dirty
        if (now.deleted) await db.remove('prompts', now.id);
        else await db.put('prompts', { ...now, dirty: false, syncError: rejected.has(now.id) || undefined });
      }
      for (const incoming of res.changes || []) {
        const local = await db.get('prompts', incoming.id);
        if (local && local.userId !== user.id) continue;
        if (local?.dirty && Number(local.updatedAt) > Number(incoming.updatedAt)) continue;
        if (incoming.deleted) {
          if (local) { await db.remove('prompts', incoming.id); pulled = true; }
        } else if (!local || local.updatedAt !== incoming.updatedAt || local.dirty) {
          await db.put('prompts', { ...incoming, userId: user.id, dirty: false });
          pulled = true;
        }
      }
      cursor = res.cursor;
      writeCursor(user.id, cursor);
      more = Boolean(res.more);
    }
    failures = 0;
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      auth.refresh(); // signs out and tells the app why
    } else {
      failures += 1;
      schedule(Math.min(300000, 15000 * 2 ** Math.min(failures, 4))); // offline or server busy: retry later
    }
  } finally {
    running = false;
    if (pulled) window.dispatchEvent(new CustomEvent('pc:synced'));
    if (again) { again = false; schedule(300); }
  }
}

/** Starts syncing for the signed-in user; call once at boot. */
export function start() {
  window.addEventListener('pc:local-change', () => schedule());
  window.addEventListener('pc:auth', (e) => { if (e.detail?.user) schedule(0); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(0); });
  window.addEventListener('online', () => schedule(0));
  setInterval(() => { if (document.visibilityState === 'visible') run(); }, 60000);
  schedule(0);
}
