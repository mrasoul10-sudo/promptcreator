// Test doubles for the worker's Cloudflare bindings, shared by the worker unit test and the e2e test:
// a SQLite-backed Durable Object namespace (node:sqlite, in memory) and a Google identity token signer
// (a local RSA key whose public half is served as Google's JWKS).

import { DatabaseSync } from 'node:sqlite';
import { generateKeyPairSync, createSign } from 'node:crypto';

process.removeAllListeners('warning'); // node:sqlite prints an experimental-feature warning

/** Durable Object storage with the `sql.exec(query, ...params).toArray()` API. */
function fakeSqlStorage() {
  const db = new DatabaseSync(':memory:');
  return {
    sql: {
      exec(query, ...params) {
        const statement = db.prepare(query);
        const rows = /^\s*SELECT|RETURNING/i.test(query) ? statement.all(...params) : (statement.run(...params), []);
        return { toArray: () => rows.map((r) => ({ ...r })) };
      },
    },
  };
}

/** A namespace whose every id maps to one instance of `Klass` (the worker uses a single named instance). */
export function fakeSqlNamespace(Klass, env) {
  const instance = new Klass({ storage: fakeSqlStorage() }, env);
  return {
    instance,
    idFromName: () => 'main',
    get: () => ({ fetch: (url, init) => instance.fetch(new Request(url, init)) }),
  };
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'test-key-1';
export const GOOGLE_JWKS = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' }] };

const b64url = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

/** A Google ID token signed with the test key (verifiable against GOOGLE_JWKS). */
export function googleIdToken(claims) {
  const head = b64url({ alg: 'RS256', kid: KID, typ: 'JWT' });
  const body = b64url({ iss: 'https://accounts.google.com', exp: Math.floor(Date.now() / 1000) + 3600, email_verified: true, ...claims });
  const signature = createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey).toString('base64url');
  return `${head}.${body}.${signature}`;
}
