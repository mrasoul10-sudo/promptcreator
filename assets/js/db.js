// Thin promise wrapper around IndexedDB. All app data lives in the viewer's browser.

const DB_NAME = 'promptcreator';
const DB_VERSION = 1;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('users')) {
        const users = db.createObjectStore('users', { keyPath: 'id' });
        users.createIndex('email', 'email', { unique: true });
      }
      if (!db.objectStoreNames.contains('prompts')) {
        const prompts = db.createObjectStore('prompts', { keyPath: 'id' });
        prompts.createIndex('userId', 'userId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('پایگاه داده توسط تب دیگری قفل شده است. تب‌های دیگر را ببندید.'));
  });
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export async function get(storeName, key) {
  return wrap((await store(storeName)).get(key));
}

export async function put(storeName, value) {
  await wrap((await store(storeName, 'readwrite')).put(value));
  return value;
}

export async function remove(storeName, key) {
  return wrap((await store(storeName, 'readwrite')).delete(key));
}

export async function getByIndex(storeName, index, value) {
  return wrap((await store(storeName)).index(index).get(value));
}

export async function getAllByIndex(storeName, index, value) {
  return wrap((await store(storeName)).index(index).getAll(value));
}

/** Writes many records in a single transaction (used by backup import). */
export async function putMany(storeName, values) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const s = tx.objectStore(storeName);
    values.forEach((v) => s.put(v));
    tx.oncomplete = () => resolve(values.length);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Deletes many records by key in a single transaction. */
export async function removeMany(storeName, keys) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const s = tx.objectStore(storeName);
    keys.forEach((k) => s.delete(k));
    tx.oncomplete = () => resolve(keys.length);
    tx.onerror = () => reject(tx.error);
  });
}

export function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
