// Accounts, sessions and synced prompts: one SQLite-backed Durable Object ("Store", single instance).
//
// Passwords: the browser stretches the password with PBKDF2 (210k iterations, per-account random client salt)
// and sends only the 256-bit result; here it is hashed once more with SHA-256 and a server salt. The expensive
// work stays in the browser (Workers have a small CPU budget), and a leaked table still costs PBKDF2 per guess.
//
// Sessions: random 256-bit bearer tokens; only their SHA-256 is stored.
// Prompts: opaque JSON records per user, last write wins by the client's updatedAt; every accepted write gets a
// new global sequence number, and clients pull "everything after seq N" (tombstones included).
// Admin: the account whose email equals ADMIN_EMAIL, and only once that email is proven by a Google sign-in.

const DAY = 86400000;
const SESSION_DAYS_REMEMBER = 180;
const SESSION_DAYS_SHORT = 2;
const MAX_PROMPTS_PER_USER = 5000;
const MAX_RECORD_BYTES = 100_000;
const MAX_CHANGES = 200;
const PULL_PAGE = 300;
const MAX_AVATAR_CHARS = 200_000;
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f97316', '#10b981', '#0ea5e9', '#14b8a6', '#f43f5e'];

class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const bad = (message) => new ApiError(400, 'bad_request', message);
const DENIED = () => new ApiError(401, 'unauthorized', 'نشست شما منقضی شده است. دوباره وارد شوید.');

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(n) {
  return hex(crypto.getRandomValues(new Uint8Array(n)));
}

async function sha256(text) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function checkEmail(email) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw bad('ایمیل معتبر نیست.');
}

function checkName(name) {
  const n = String(name || '').trim();
  if (n.length < 2 || n.length > 80) throw bad('نام باید بین ۲ تا ۸۰ کاراکتر باشد.');
  return n;
}

/** The browser-derived password key: 64 hex characters. */
function checkKey(key) {
  if (!/^[0-9a-f]{64}$/.test(String(key || ''))) throw bad('رمز عبور نامعتبر است.');
  return key;
}

function checkAvatar(avatar) {
  if (avatar === null || avatar === undefined || avatar === '') return null;
  const a = String(avatar);
  if (a.length > MAX_AVATAR_CHARS) throw bad('تصویر پروفایل بیش از حد بزرگ است.');
  if (/^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(a)) return a;
  if (/^https:\/\/[a-z0-9.-]*googleusercontent\.com\/[^\s"'<>]+$/.test(a) && a.length < 1000) return a;
  throw bad('تصویر پروفایل نامعتبر است.');
}

function newRecoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join('');
}

function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const formatCode = (raw) => raw.match(/.{4}/g).join('-');

export class Store {
  constructor(state, env) {
    this.env = env || {};
    this.sql = state.storage.sql;
    this.migrate();
    this.seq = Number(this.one('SELECT COALESCE(MAX(seq), 0) AS s FROM prompts')?.s || 0);
  }

  // ---------- SQL helpers ----------

  all(query, ...params) {
    return this.sql.exec(query, ...params).toArray();
  }

  one(query, ...params) {
    return this.all(query, ...params)[0] || null;
  }

  run(query, ...params) {
    this.sql.exec(query, ...params);
  }

  migrate() {
    this.run(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, avatar TEXT, color TEXT,
      client_salt TEXT NOT NULL, pass_salt TEXT, pass_hash TEXT, google_sub TEXT UNIQUE,
      recovery_salt TEXT, recovery_hash TEXT, blocked INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_seen INTEGER)`);
    this.run(`CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, via TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`);
    this.run('CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)');
    this.run(`CREATE TABLE IF NOT EXISTS prompts (
      user_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT, deleted INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER, updated_at INTEGER NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY (user_id, id))`);
    this.run('CREATE INDEX IF NOT EXISTS prompts_seq ON prompts(user_id, seq)');
    this.run('CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL)');
  }

  // ---------- Accounts ----------

  isAdmin(user) {
    const admin = normalizeEmail(this.env.ADMIN_EMAIL);
    return Boolean(admin && user.email === admin && user.google_sub);
  }

  publicUser(user) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: user.avatar || null,
      color: user.color,
      hasPassword: Boolean(user.pass_hash),
      google: Boolean(user.google_sub),
      hasRecovery: Boolean(user.recovery_hash),
      admin: this.isAdmin(user),
      createdAt: user.created_at,
    };
  }

  userByEmail(email) {
    return this.one('SELECT * FROM users WHERE email = ?', normalizeEmail(email));
  }

  async passHash(salt, key) {
    return sha256(`${salt}:${key}`);
  }

  async setPassword(userId, key) {
    const salt = randomHex(16);
    this.run('UPDATE users SET pass_salt = ?, pass_hash = ?, updated_at = ? WHERE id = ?', salt, await this.passHash(salt, key), Date.now(), userId);
  }

  async setRecovery(userId) {
    const raw = newRecoveryCode();
    const salt = randomHex(16);
    this.run('UPDATE users SET recovery_salt = ?, recovery_hash = ? WHERE id = ?', salt, await sha256(`${salt}:${raw}`), userId);
    return formatCode(raw);
  }

  async openSession(user, via, remember) {
    if (user.blocked) throw new ApiError(403, 'blocked', 'این حساب مسدود شده است.');
    const token = randomHex(32);
    const now = Date.now();
    const days = remember === false ? SESSION_DAYS_SHORT : SESSION_DAYS_REMEMBER;
    this.run('INSERT INTO sessions (token_hash, user_id, via, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      await sha256(token), user.id, via, now, now + days * DAY);
    this.run('UPDATE users SET last_seen = ? WHERE id = ?', now, user.id);
    this.run('DELETE FROM sessions WHERE expires_at < ?', now);
    return token;
  }

  async session(token) {
    if (!/^[0-9a-f]{64}$/.test(String(token || ''))) throw DENIED();
    const s = this.one('SELECT * FROM sessions WHERE token_hash = ?', await sha256(token));
    if (!s || s.expires_at < Date.now()) throw DENIED();
    const user = this.one('SELECT * FROM users WHERE id = ?', s.user_id);
    if (!user) throw DENIED();
    if (user.blocked) throw new ApiError(403, 'blocked', 'این حساب مسدود شده است.');
    // Activity for the admin panel, written at most every 10 minutes per user.
    if (!user.last_seen || Date.now() - user.last_seen > 600000) this.run('UPDATE users SET last_seen = ? WHERE id = ?', Date.now(), user.id);
    return { session: s, user };
  }

  /** At most `max` failures per key per hour (brute-force guard for passwords and recovery codes). */
  limitAttempts(key, max = 10) {
    const row = this.one('SELECT * FROM attempts WHERE key = ?', key);
    if (row && row.reset_at > Date.now() && row.count >= max) {
      throw new ApiError(429, 'too_many', 'تلاش‌های ناموفق زیاد بود. یک ساعت دیگر دوباره تلاش کنید.');
    }
  }

  failAttempt(key) {
    const now = Date.now();
    const row = this.one('SELECT * FROM attempts WHERE key = ?', key);
    if (!row || row.reset_at < now) this.run('INSERT OR REPLACE INTO attempts (key, count, reset_at) VALUES (?, 1, ?)', key, now + 3600000);
    else this.run('UPDATE attempts SET count = count + 1 WHERE key = ?', key);
  }

  lookup({ email }) {
    const e = normalizeEmail(email);
    checkEmail(e);
    const user = this.userByEmail(e);
    return user
      ? { exists: true, clientSalt: user.client_salt, hasPassword: Boolean(user.pass_hash), google: Boolean(user.google_sub) }
      : { exists: false };
  }

  async register({ name, email, clientSalt, key, avatar, remember }) {
    const e = normalizeEmail(email);
    checkEmail(e);
    const n = checkName(name);
    checkKey(key);
    if (!/^[0-9a-f]{32}$/.test(String(clientSalt || ''))) throw bad('درخواست نامعتبر است.');
    if (this.userByEmail(e)) throw new ApiError(409, 'exists', 'حسابی با این ایمیل وجود دارد. وارد شوید.');
    const now = Date.now();
    const id = crypto.randomUUID();
    this.run(`INSERT INTO users (id, email, name, avatar, color, client_salt, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, id, e, n, checkAvatar(avatar), COLORS[Math.floor(Math.random() * COLORS.length)], clientSalt, now, now);
    await this.setPassword(id, key);
    const recoveryCode = await this.setRecovery(id);
    const user = this.one('SELECT * FROM users WHERE id = ?', id);
    return { token: await this.openSession(user, 'password', remember), user: this.publicUser(user), recoveryCode };
  }

  async login({ email, key, remember }) {
    const e = normalizeEmail(email);
    this.limitAttempts(`login:${e}`);
    const user = this.userByEmail(e);
    if (user && !user.pass_hash) throw new ApiError(400, 'google_only', 'این حساب با گوگل ساخته شده است؛ با دکمه «ادامه با گوگل» وارد شوید.');
    if (!user || (await this.passHash(user.pass_salt, checkKey(key))) !== user.pass_hash) {
      this.failAttempt(`login:${e}`);
      throw new ApiError(401, 'wrong_password', 'ایمیل یا رمز عبور اشتباه است.');
    }
    return { token: await this.openSession(user, 'password', remember), user: this.publicUser(user) };
  }

  /** `claims` were verified by the worker (Google's signature, audience, issuer, expiry, verified email). */
  async google({ claims, remember }) {
    const e = normalizeEmail(claims.email);
    let user = this.one('SELECT * FROM users WHERE google_sub = ?', String(claims.sub)) || this.userByEmail(e);
    let passwordRemoved = false;
    const now = Date.now();
    if (!user) {
      const id = crypto.randomUUID();
      this.run(`INSERT INTO users (id, email, name, avatar, color, client_salt, google_sub, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, e, checkName(String(claims.name || e.split('@')[0]).slice(0, 80).padEnd(2, '_')),
      checkAvatar(claims.picture), COLORS[Math.floor(Math.random() * COLORS.length)], randomHex(16), String(claims.sub), now, now);
      user = this.one('SELECT * FROM users WHERE id = ?', id);
    } else if (!user.google_sub) {
      // First Google sign-in for an account created with email + password. The email was never verified, so
      // whoever set that password may not own the address: drop the password and all sessions (the owner can
      // set a new password from the profile page).
      if (user.pass_hash) passwordRemoved = true;
      this.run('UPDATE users SET google_sub = ?, pass_hash = NULL, pass_salt = NULL, updated_at = ? WHERE id = ?', String(claims.sub), now, user.id);
      this.run('DELETE FROM sessions WHERE user_id = ?', user.id);
      if (!user.avatar && claims.picture) this.run('UPDATE users SET avatar = ? WHERE id = ?', checkAvatar(claims.picture), user.id);
      user = this.one('SELECT * FROM users WHERE id = ?', user.id);
    } else if (user.google_sub !== String(claims.sub)) {
      throw new ApiError(409, 'other_google', 'این ایمیل به حساب گوگل دیگری متصل است.');
    }
    return { token: await this.openSession(user, 'google', remember), user: this.publicUser(user), passwordRemoved };
  }

  async reset({ email, code, key, remember }) {
    const e = normalizeEmail(email);
    this.limitAttempts(`reset:${e}`, 5);
    const user = this.userByEmail(e);
    const ok = user?.recovery_hash && (await sha256(`${user.recovery_salt}:${normalizeCode(code)}`)) === user.recovery_hash;
    if (!ok) {
      this.failAttempt(`reset:${e}`);
      throw new ApiError(401, 'wrong_code', 'ایمیل یا کد بازیابی اشتباه است.');
    }
    checkKey(key);
    await this.setPassword(user.id, key);
    this.run('DELETE FROM sessions WHERE user_id = ?', user.id);
    const recoveryCode = await this.setRecovery(user.id);
    const fresh = this.one('SELECT * FROM users WHERE id = ?', user.id);
    return { token: await this.openSession(fresh, 'password', remember), user: this.publicUser(fresh), recoveryCode };
  }

  async logout({ token }) {
    if (/^[0-9a-f]{64}$/.test(String(token || ''))) this.run('DELETE FROM sessions WHERE token_hash = ?', await sha256(token));
    return { ok: true };
  }

  // ---------- Signed-in user ----------

  async me({ token }) {
    const { user } = await this.session(token);
    return { user: this.publicUser(user) };
  }

  async updateMe({ token, name, email, avatar }) {
    const { user } = await this.session(token);
    const next = { name: user.name, email: user.email, avatar: user.avatar };
    if (name !== undefined) next.name = checkName(name);
    if (avatar !== undefined) next.avatar = checkAvatar(avatar);
    if (email !== undefined) {
      const e = normalizeEmail(email);
      checkEmail(e);
      if (e !== user.email) {
        // A Google-linked address is verified; changing it would detach the account from that proof.
        if (user.google_sub) throw bad('ایمیل حساب‌های متصل به گوگل قابل تغییر نیست.');
        if (this.userByEmail(e)) throw new ApiError(409, 'exists', 'این ایمیل برای حساب دیگری استفاده شده است.');
        next.email = e;
      }
    }
    this.run('UPDATE users SET name = ?, email = ?, avatar = ?, updated_at = ? WHERE id = ?', next.name, next.email, next.avatar, Date.now(), user.id);
    return { user: this.publicUser(this.one('SELECT * FROM users WHERE id = ?', user.id)) };
  }

  async changePassword({ token, oldKey, key }) {
    const { user, session } = await this.session(token);
    checkKey(key);
    // Old password needed unless the account has none, or this session was opened with Google (forgot-password path).
    if (user.pass_hash && session.via !== 'google') {
      this.limitAttempts(`change:${user.id}`);
      if ((await this.passHash(user.pass_salt, checkKey(oldKey))) !== user.pass_hash) {
        this.failAttempt(`change:${user.id}`);
        throw new ApiError(401, 'wrong_password', 'رمز عبور فعلی اشتباه است.');
      }
    }
    await this.setPassword(user.id, key);
    return { user: this.publicUser(this.one('SELECT * FROM users WHERE id = ?', user.id)) };
  }

  async newRecovery({ token }) {
    const { user } = await this.session(token);
    const recoveryCode = await this.setRecovery(user.id);
    return { recoveryCode, user: this.publicUser(this.one('SELECT * FROM users WHERE id = ?', user.id)) };
  }

  async deleteMe({ token, key, email }) {
    const { user } = await this.session(token);
    const ok = user.pass_hash
      ? (await this.passHash(user.pass_salt, checkKey(key))) === user.pass_hash
      : normalizeEmail(email) === user.email;
    if (!ok) throw new ApiError(401, 'wrong_password', user.pass_hash ? 'رمز عبور اشتباه است.' : 'ایمیل وارد شده با ایمیل حساب یکسان نیست.');
    this.deleteUser(user.id);
    return { ok: true };
  }

  deleteUser(id) {
    this.run('DELETE FROM prompts WHERE user_id = ?', id);
    this.run('DELETE FROM sessions WHERE user_id = ?', id);
    this.run('DELETE FROM users WHERE id = ?', id);
  }

  // ---------- Sync ----------

  /**
   * Applies the client's changes (last write wins by updatedAt), then returns every record of this user with
   * seq > since. `rejected` lists ids the server refused (too large, over the per-user limit).
   */
  async sync({ token, since, changes }) {
    const { user } = await this.session(token);
    if (!Array.isArray(changes) || changes.length > MAX_CHANGES) throw bad('درخواست همگام‌سازی نامعتبر است.');
    const rejected = [];
    let count = null;
    for (const c of changes) {
      const id = String(c?.id || '');
      const updatedAt = Number(c?.updatedAt);
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !Number.isFinite(updatedAt)) { rejected.push(id); continue; }
      const existing = this.one('SELECT updated_at FROM prompts WHERE user_id = ? AND id = ?', user.id, id);
      if (existing && existing.updated_at >= updatedAt) continue; // the server already has a newer (or the same) version
      if (c.deleted) {
        this.run(`INSERT INTO prompts (user_id, id, data, deleted, archived, created_at, updated_at, seq) VALUES (?, ?, NULL, 1, 0, NULL, ?, ?)
          ON CONFLICT (user_id, id) DO UPDATE SET data = NULL, deleted = 1, archived = 0, updated_at = excluded.updated_at, seq = excluded.seq`,
        user.id, id, updatedAt, ++this.seq);
        continue;
      }
      const record = { ...c };
      delete record.userId;
      delete record.dirty;
      const data = JSON.stringify(record);
      if (data.length > MAX_RECORD_BYTES) { rejected.push(id); continue; }
      if (!existing) {
        count ??= Number(this.one('SELECT COUNT(*) AS n FROM prompts WHERE user_id = ? AND deleted = 0', user.id).n);
        if (count >= MAX_PROMPTS_PER_USER) { rejected.push(id); continue; }
        count += 1;
      }
      this.run(`INSERT INTO prompts (user_id, id, data, deleted, archived, created_at, updated_at, seq) VALUES (?, ?, ?, 0, ?, ?, ?, ?)
        ON CONFLICT (user_id, id) DO UPDATE SET data = excluded.data, deleted = 0, archived = excluded.archived,
          created_at = excluded.created_at, updated_at = excluded.updated_at, seq = excluded.seq`,
      user.id, id, data, record.archived ? 1 : 0, Number(record.createdAt) || Date.now(), updatedAt, ++this.seq);
    }
    const from = Math.max(0, Number(since) || 0);
    const rows = this.all('SELECT id, data, deleted, updated_at, seq FROM prompts WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?', user.id, from, PULL_PAGE + 1);
    const more = rows.length > PULL_PAGE;
    const page = rows.slice(0, PULL_PAGE);
    return {
      changes: page.map((r) => (r.deleted ? { id: r.id, deleted: true, updatedAt: r.updated_at } : { ...JSON.parse(r.data), id: r.id, updatedAt: r.updated_at })),
      cursor: page.length ? page.at(-1).seq : from,
      more,
      rejected,
    };
  }

  // ---------- Admin ----------

  async admin(token) {
    const ctx = await this.session(token);
    if (!this.isAdmin(ctx.user)) throw new ApiError(403, 'forbidden', 'دسترسی مدیریت ندارید.');
    return ctx;
  }

  async adminStats({ token, quota }) {
    await this.admin(token);
    const now = Date.now();
    const today = new Date(new Date(now).toISOString().slice(0, 10)).getTime();
    const n = (q, ...p) => Number(this.one(q, ...p)?.n || 0);
    return {
      users: {
        total: n('SELECT COUNT(*) AS n FROM users'),
        today: n('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', today),
        week: n('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', now - 7 * DAY),
        activeToday: n('SELECT COUNT(*) AS n FROM users WHERE last_seen >= ?', today),
        activeWeek: n('SELECT COUNT(*) AS n FROM users WHERE last_seen >= ?', now - 7 * DAY),
        google: n('SELECT COUNT(*) AS n FROM users WHERE google_sub IS NOT NULL'),
        password: n('SELECT COUNT(*) AS n FROM users WHERE pass_hash IS NOT NULL'),
        blocked: n('SELECT COUNT(*) AS n FROM users WHERE blocked = 1'),
      },
      prompts: {
        total: n('SELECT COUNT(*) AS n FROM prompts WHERE deleted = 0'),
        today: n('SELECT COUNT(*) AS n FROM prompts WHERE deleted = 0 AND created_at >= ?', today),
        week: n('SELECT COUNT(*) AS n FROM prompts WHERE deleted = 0 AND created_at >= ?', now - 7 * DAY),
        archived: n('SELECT COUNT(*) AS n FROM prompts WHERE deleted = 0 AND archived = 1'),
      },
      quota: quota || null,
    };
  }

  async adminUsers({ token, q, offset }) {
    await this.admin(token);
    const like = `%${String(q || '').trim().toLowerCase().slice(0, 100)}%`;
    const rows = this.all(`SELECT u.*, (SELECT COUNT(*) FROM prompts p WHERE p.user_id = u.id AND p.deleted = 0) AS prompt_count
      FROM users u WHERE lower(u.email) LIKE ? OR lower(u.name) LIKE ?
      ORDER BY COALESCE(u.last_seen, u.created_at) DESC LIMIT 51 OFFSET ?`, like, like, Math.max(0, Number(offset) || 0));
    return {
      users: rows.slice(0, 50).map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        avatar: u.avatar && u.avatar.length < 2000 ? u.avatar : null,
        google: Boolean(u.google_sub),
        password: Boolean(u.pass_hash),
        blocked: Boolean(u.blocked),
        admin: this.isAdmin(u),
        prompts: Number(u.prompt_count),
        createdAt: u.created_at,
        lastSeen: u.last_seen,
      })),
      more: rows.length > 50,
    };
  }

  async adminAction({ token, id, action }) {
    const { user: me } = await this.admin(token);
    const target = this.one('SELECT * FROM users WHERE id = ?', String(id || ''));
    if (!target) throw new ApiError(404, 'not_found', 'کاربر پیدا نشد.');
    if (target.id === me.id) throw bad('این کار روی حساب خودتان ممکن نیست.');
    if (action === 'block') {
      this.run('UPDATE users SET blocked = 1 WHERE id = ?', target.id);
      this.run('DELETE FROM sessions WHERE user_id = ?', target.id);
    } else if (action === 'unblock') {
      this.run('UPDATE users SET blocked = 0 WHERE id = ?', target.id);
    } else if (action === 'delete') {
      this.deleteUser(target.id);
    } else {
      throw bad('عملیات نامعتبر است.');
    }
    return { ok: true };
  }

  // ---------- Entry point (called by the worker) ----------

  async fetch(request) {
    const { op, ...args } = await request.json();
    const ops = {
      lookup: () => this.lookup(args),
      register: () => this.register(args),
      login: () => this.login(args),
      google: () => this.google(args),
      reset: () => this.reset(args),
      logout: () => this.logout(args),
      me: () => this.me(args),
      updateMe: () => this.updateMe(args),
      changePassword: () => this.changePassword(args),
      newRecovery: () => this.newRecovery(args),
      deleteMe: () => this.deleteMe(args),
      sync: () => this.sync(args),
      adminCheck: () => this.admin(args.token).then(() => ({ ok: true })),
      adminStats: () => this.adminStats(args),
      adminUsers: () => this.adminUsers(args),
      adminAction: () => this.adminAction(args),
    };
    if (!ops[op]) return Response.json({ error: 'not_found', message: 'Not found' }, { status: 404 });
    try {
      return Response.json(await ops[op]());
    } catch (err) {
      if (err instanceof ApiError) return Response.json({ error: err.code, message: err.message, ...err.extra }, { status: err.status });
      console.error('store error', op, err);
      return Response.json({ error: 'server', message: 'خطای سرور. کمی بعد دوباره تلاش کنید.' }, { status: 500 });
    }
  }
}
