// Prompt records: history (every generation) and archive (records the user chose to keep).

import * as db from './db.js?v=202609251117';

const EDITABLE = ['title', 'promptEn', 'promptFa', 'notes', 'category', 'tags', 'favorite'];

export async function listForUser(userId) {
  const rows = await db.getAllByIndex('prompts', 'userId', userId);
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function create(userId, data) {
  const now = Date.now();
  return db.put('prompts', {
    id: db.uid(),
    userId,
    source: data.source,
    title: data.title || '',
    promptEn: data.promptEn || '',
    promptFa: data.promptFa || '',
    improvements: data.improvements || [],
    type: data.type,
    lang: data.lang,
    detail: data.detail,
    model: data.model || '',
    usage: data.usage || null,
    notes: '',
    category: '',
    tags: [],
    favorite: false,
    archived: false,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  });
}

async function owned(userId, id) {
  const row = await db.get('prompts', id);
  if (!row || row.userId !== userId) throw new Error('پرامپت پیدا نشد.');
  return row;
}

export async function get(userId, id) {
  return owned(userId, id);
}

export async function update(userId, id, patch) {
  const row = await owned(userId, id);
  const clean = {};
  for (const key of EDITABLE) if (key in patch) clean[key] = patch[key];
  if ('tags' in clean) clean.tags = normalizeTags(clean.tags);
  if ('category' in clean) clean.category = String(clean.category || '').trim().slice(0, 60);
  if ('title' in clean) clean.title = String(clean.title || '').trim().slice(0, 160);
  return db.put('prompts', { ...row, ...clean, updatedAt: Date.now() });
}

export async function archive(userId, id, meta = {}) {
  const row = await update(userId, id, meta);
  return db.put('prompts', { ...row, archived: true, archivedAt: row.archivedAt || Date.now() });
}

export async function unarchive(userId, id) {
  const row = await owned(userId, id);
  return db.put('prompts', { ...row, archived: false, archivedAt: null, updatedAt: Date.now() });
}

export async function remove(userId, id) {
  await owned(userId, id);
  return db.remove('prompts', id);
}

/** Removes history entries that were never archived. */
export async function clearHistory(userId) {
  const rows = await db.getAllByIndex('prompts', 'userId', userId);
  return db.removeMany('prompts', rows.filter((r) => !r.archived).map((r) => r.id));
}

export function normalizeTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags || '').split(/[,،#\n]+/);
  return [...new Set(list.map((t) => String(t).trim().replace(/\s+/g, ' ').slice(0, 40)).filter(Boolean))].slice(0, 20);
}

// ---------- Search ----------

// Folds Arabic/Persian letter variants, diacritics, digits and zero-width chars so "كتاب" matches "کتاب".
export function fold(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/[‌‍‎‏]/g, ' ')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

function haystack(row) {
  return fold([row.title, row.source, row.promptEn, row.promptFa, row.notes, row.category, (row.tags || []).join(' ')].join('\n'));
}

export function queryTerms(query) {
  return fold(query).split(/\s+/).filter(Boolean);
}

/**
 * @param {Array} rows
 * @param {{q?:string, category?:string, tag?:string, type?:string, lang?:string, favorite?:boolean, from?:string, to?:string, sort?:string}} f
 */
export function search(rows, f = {}) {
  const terms = queryTerms(f.q);
  const from = f.from ? new Date(`${f.from}T00:00:00`).getTime() : null;
  const to = f.to ? new Date(`${f.to}T23:59:59.999`).getTime() : null;

  const result = rows.filter((r) => {
    if (f.category && r.category !== f.category) return false;
    if (f.tag && !(r.tags || []).includes(f.tag)) return false;
    if (f.type && r.type !== f.type) return false;
    if (f.lang && r.lang !== f.lang) return false;
    if (f.favorite && !r.favorite) return false;
    if (from && r.createdAt < from) return false;
    if (to && r.createdAt > to) return false;
    if (terms.length) {
      const h = haystack(r);
      if (!terms.every((t) => h.includes(t))) return false;
    }
    return true;
  });

  const sorters = {
    newest: (a, b) => b.createdAt - a.createdAt,
    oldest: (a, b) => a.createdAt - b.createdAt,
    updated: (a, b) => b.updatedAt - a.updatedAt,
    title: (a, b) => (a.title || '').localeCompare(b.title || '', 'fa'),
  };
  return result.sort(sorters[f.sort] || sorters.newest);
}

export function facets(rows) {
  const categories = new Map();
  const tags = new Map();
  for (const r of rows) {
    if (r.category) categories.set(r.category, (categories.get(r.category) || 0) + 1);
    for (const t of r.tags || []) tags.set(t, (tags.get(t) || 0) + 1);
  }
  const sorted = (m) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fa'));
  return { categories: sorted(categories), tags: sorted(tags) };
}

// ---------- Backup ----------

export async function exportData(user) {
  const rows = await listForUser(user.id);
  return {
    app: 'promptcreator',
    version: 1,
    exportedAt: new Date().toISOString(),
    profile: { name: user.name, email: user.email },
    prompts: rows.map(({ userId, ...rest }) => rest),
  };
}

export async function importData(userId, payload) {
  if (!payload || payload.app !== 'promptcreator' || !Array.isArray(payload.prompts)) {
    throw new Error('فایل پشتیبان معتبر نیست.');
  }
  // Re-importing the same backup overwrites instead of duplicating; ids owned by another local account get a fresh id.
  const valid = payload.prompts.filter((p) => p && typeof p === 'object' && typeof p.source === 'string');
  const ids = await Promise.all(valid.map(async (p) => {
    if (typeof p.id !== 'string' || !p.id) return db.uid();
    const clash = await db.get('prompts', p.id);
    return clash && clash.userId !== userId ? db.uid() : p.id;
  }));
  const rows = valid
    .map((p, i) => ({
      id: ids[i],
      userId,
      source: p.source,
      title: String(p.title || ''),
      promptEn: String(p.promptEn || ''),
      promptFa: String(p.promptFa || ''),
      improvements: Array.isArray(p.improvements) ? p.improvements.map(String) : [],
      type: String(p.type || 'general'),
      lang: String(p.lang || 'both'),
      detail: String(p.detail || 'balanced'),
      model: String(p.model || ''),
      usage: p.usage || null,
      notes: String(p.notes || ''),
      category: String(p.category || ''),
      tags: normalizeTags(p.tags),
      favorite: Boolean(p.favorite),
      archived: Boolean(p.archived),
      archivedAt: p.archivedAt || null,
      createdAt: Number(p.createdAt) || Date.now(),
      updatedAt: Number(p.updatedAt) || Date.now(),
    }));
  await db.putMany('prompts', rows);
  return rows.length;
}
