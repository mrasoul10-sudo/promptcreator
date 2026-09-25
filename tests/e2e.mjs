// End-to-end smoke test: runs the app in headless Chromium against a mocked Claude API.
// Usage: serve the repo root (e.g. `python3 -m http.server 8765`), then `node tests/e2e.mjs [baseUrl]`.
// Requires Playwright (`npm i -g playwright` or `npx playwright`).

import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const BASE = process.argv[2] || 'http://localhost:8765/';
const requests = [];

function sse(model, json) {
  const events = [
    ['message_start', { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 812, output_tokens: 0 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: json.slice(0, 40) } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: json.slice(40) } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 420 } }],
    ['message_stop', { type: 'message_stop' }],
  ];
  return events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
}

// A fake microphone (a test tone) so voice input can record without a real device or permission prompt.
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
// bypassCSP only lets Playwright's own waitForFunction helpers run; the app itself never needs eval.
const context = await browser.newContext({ bypassCSP: true, viewport: { width: 1280, height: 860 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// Resource errors are expected here: fonts are blocked and one API call is a deliberate 401.
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());


// Google sign-in: enable it with a test client ID and replace Google's script with a stub that returns a signed-in user.
const GOOGLE_ID = 'test-client.apps.googleusercontent.com';
const FREE_API = 'https://promptcreator-api.test.workers.dev';
const CONFIG_JS = `export const GOOGLE_CLIENT_ID = '${GOOGLE_ID}';\nexport const FREE_API_URL = '${FREE_API}';\nexport const ANDROID_APK_URL = 'https://github.com/mrasoul10-sudo/promptcreator/releases/download/android-latest/promptsaz.apk';\nexport const ANDROID_RELEASES_URL = 'https://github.com/mrasoul10-sudo/promptcreator/releases/latest';`;
await context.route(/assets\/js\/config\.js/, (r) => r.fulfill({ contentType: 'text/javascript', body: CONFIG_JS }));

// Free service (worker/) mock
const freeRequests = [];
let freeRemaining = 20;
const transcribeRequests = [];
await context.route(`${FREE_API}/**`, async (route) => {
  const req = route.request();
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  if (req.url().endsWith('/quota')) return route.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify({ remaining: freeRemaining, limit: 20 }) });
  if (req.url().endsWith('/transcribe')) {
    // Voice input: the browser must send a WAV recording; the worker answers with clean text.
    const audio = req.postDataBuffer();
    transcribeRequests.push({ type: req.headers()['content-type'], riff: audio?.subarray(0, 4).toString(), bytes: audio?.length || 0 });
    return route.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify({ text: 'یک لوگو برای نانوایی', language: 'fa', model: 'gemini-flash' }) });
  }
  const body = JSON.parse(req.postData());
  freeRequests.push(body);
  freeRemaining -= 1;
  // Same shape the real worker returns (normalized camelCase result).
  const m = mockResult(body.source);
  const result = { title: m.title, detectedLanguage: m.detected_language, promptEn: body.lang === 'fa' ? '' : m.prompt_en, promptFa: body.lang === 'en' ? '' : m.prompt_fa, notes: m.notes };
  return route.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify({ result, model: 'gemini-flash', usage: { input: 1, output: 1 }, remaining: freeRemaining }) });
});
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = `${b64url({ alg: 'none' })}.${b64url({ iss: 'https://accounts.google.com', aud: GOOGLE_ID, sub: 'g-123', email: 'maryam@gmail.com', email_verified: true, name: 'مریم گوگلی', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
await context.route('https://accounts.google.com/gsi/client', (r) => r.fulfill({
  contentType: 'text/javascript',
  body: `window.google = { accounts: { id: {
    initialize(c) { this.cb = c.callback; },
    renderButton(el) { const b = document.createElement('button'); b.type = 'button'; b.id = 'gsi-stub'; b.textContent = 'Continue with Google'; b.onclick = () => this.cb({ credential: ${JSON.stringify(idToken)} }); el.appendChild(b); const f = document.createElement('iframe'); f.src = 'about:blank'; f.style.display = 'none'; el.appendChild(f); },
  } } };`,
}));
await context.route('https://api.anthropic.com/**', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  const url = req.url();
  const cors = { 'access-control-allow-origin': '*' };
  if (url.includes('/v1/models')) {
    const ok = req.headers()['x-api-key'] === 'sk-ant-test';
    return route.fulfill({ status: ok ? 200 : 401, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(ok ? { data: [], has_more: false, first_id: null, last_id: null } : { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }) });
  }
  const body = JSON.parse(req.postData());
  requests.push({ url, headers: req.headers(), body });
  const out = JSON.stringify(mockResult(body.messages[0].content));
  return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse(body.model, out) });
});

function mockResult(text) {
  return text.includes('python') ? {
    title: 'Python file renaming script',
    detected_language: 'en',
    prompt_en: 'Role: You are a senior Python developer.\nTask: Write a script that renames files in a folder.',
    prompt_fa: '',
    notes: ['نقش مشخص شد'],
  } : {
    title: 'لوگوی مینیمال کافه',
    detected_language: 'fa',
    prompt_en: 'Role: You are a senior brand designer.\nTask: Design a minimalist logo for a cozy café using warm colors.',
    prompt_fa: 'نقش: شما یک طراح ارشد برند هستید.\nوظیفه: یک لوگوی مینیمال برای یک کافه‌ی دنج با رنگ‌های گرم طراحی کنید.',
    notes: ['نقش مشخص شد', 'سبک و رنگ دقیق شد'],
  };
}

const step = (name) => console.log(`• ${name}`);

// Guest home: writing is open, generating asks to sign in
const SRC = 'یک لوگو برای کافه با رنگ های گرم میخوام';
const openMenu = async (item) => { await page.click('#user-menu-btn'); await page.click(`.user-menu ${item}`); };
await page.goto(BASE);
await page.waitForSelector('#composer');
assert.ok(await page.isVisible('.empty-hero'), 'composer-first home page for guests');
assert.ok(await page.isVisible('.topbar [data-login="login"]'), 'login button in the top bar');
assert.ok(!(await page.isVisible('#auth-form')), 'no login form up front');
assert.ok(await page.isDisabled('#generate-btn'), 'send is disabled while empty');
assert.equal(await page.textContent('.empty-hero h1'), 'سلام، امروز چه پرامپتی برات بسازم؟');

// Inappropriate words are refused before sign-in or any request
await page.fill('#source', 'یک متن با کلمه ک.ی.ر برای تست');
await page.click('#generate-btn');
await page.waitForSelector('.toast-error:has-text("نامناسب")');
assert.ok(!(await page.isVisible('.modal #auth-form')), 'no sign-in dialog for refused text');
assert.equal(freeRequests.length, 0);
step('inappropriate language refused client-side');

// Help and rules pages are public
await page.click('.sb-secondary a[href="#/help"]');
await page.waitForSelector('.help-card');
assert.ok((await page.locator('.help-card').count()) >= 8);
await page.click('.sb-secondary a[href="#/rules"]');
await page.waitForSelector('.rules-list li');
await page.click('.tb-title');
await page.waitForSelector('#composer');
await page.click('.sb-secondary a[href="#/app"]');
await page.waitForSelector('#apk-download');
assert.match(await page.getAttribute('#apk-download', 'href'), /releases\/download\/android-latest\/promptsaz\.apk$/);
await page.click('.tb-title');
await page.waitForSelector('#composer');
step('help, rules and app download pages open for guests');

// Desktop sidebar collapses to an icon rail (like chat apps) and expands again
await page.click('.sb-toggle');
await page.waitForTimeout(300);
assert.equal(await page.evaluate(() => Math.round(document.querySelector('.sidebar').getBoundingClientRect().width)), 60, 'rail is 60px wide');
assert.ok(await page.isVisible('#sb-new .icon'), 'icons stay visible in the rail');
assert.ok(!(await page.isVisible('#sb-new span')), 'labels hidden in the rail');
await page.click('.sb-toggle');
await page.waitForTimeout(300);
assert.ok(await page.isVisible('#sb-new span'), 'labels back when expanded');
assert.ok(await page.evaluate(() => Boolean(document.querySelector('link[rel=manifest]'))), 'web app manifest linked');
step('sidebar icon rail toggles');

// Voice input: tap to record, tap again to stop; the recording is written down by the free service
await page.fill('#source', '');
await page.click('#mic-btn');
await page.waitForSelector('#mic-btn.listening');
await page.waitForTimeout(1500);
assert.equal(transcribeRequests.length, 0, 'nothing is sent while recording');
await page.click('#mic-btn');
await page.waitForFunction(() => document.querySelector('#source').value === 'یک لوگو برای نانوایی');
await page.waitForSelector('#mic-btn:not(.listening):not(.processing)');
assert.equal(transcribeRequests.length, 1);
assert.equal(transcribeRequests[0].type, 'audio/wav');
assert.equal(transcribeRequests[0].riff, 'RIFF', 'recording sent as WAV');
assert.ok(transcribeRequests[0].bytes > 20000 && transcribeRequests[0].bytes < 200000, `16 kHz mono WAV: ${transcribeRequests[0].bytes} bytes`);
await page.fill('#source', '');
step('voice input: tap to record, tap to stop, clean text written into the composer');

// Theme toggle in the top bar
const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme || '');
await page.click('.tb-theme');
const themeAfter = await page.evaluate(() => document.documentElement.dataset.theme || '');
assert.notEqual(themeAfter, themeBefore, 'theme toggles');
await page.click('.tb-theme');

await page.fill('#source', SRC);
await page.click('#generate-btn');
await page.waitForSelector('.modal #auth-form');
await page.waitForSelector('#google-slot.ready');
assert.equal(await page.evaluate(() => Math.round(document.querySelector('#google-slot').getBoundingClientRect().height)), 44, 'Google slot keeps a fixed height (no oversized logo)');
step('guest can write on home; generate opens sign-in dialog');

// Protected page as guest opens the dialog too
await page.keyboard.press('Escape');
await page.waitForSelector('.modal-backdrop', { state: 'detached' });
await page.click('.sb-nav a[href="#/archive"]');
await page.waitForSelector('.modal #auth-form');
assert.match(page.url(), /#\/studio/);

// Email-first sign-up inside the dialog
await page.fill('#auth-form input[name=email]', 'Test@Example.com');
await page.click('#auth-form button[type=submit]');
await page.waitForSelector('#auth-form input[name=name]:visible');
assert.equal(await page.textContent('#auth-email-text'), 'test@example.com');
await page.fill('#auth-form input[name=name]', 'رسول تست');
await page.fill('#auth-form input[name=password]', 'secret123');
await page.click('#auth-form button[type=submit]');
await page.waitForSelector('.recovery-code');
const recoveryCode = (await page.textContent('.recovery-code')).trim();
assert.match(recoveryCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
await page.click('.modal-foot button:has-text("ذخیره کردم")');
await page.waitForSelector('#filters');
assert.match(page.url(), /#\/archive/, 'returns to the page that asked for sign-in');
await page.click('.tb-title');
await page.waitForSelector('#composer');
assert.equal(await page.inputValue('#source'), SRC, 'draft kept');
assert.ok(!(await page.isVisible('.banner')), 'free engine needs no API key');
assert.equal(await page.textContent('.empty-hero h1'), 'سلام رسول، امروز چه پرامپتی برات بسازم؟', 'greets the user by first name');
step('email-first sign-up, recovery code, returned to archive, draft kept');

// Free engine (default): no key, quota shown and updated, chat-style thread
await page.waitForSelector('#quota-note:has-text("۲۰")');
await page.click('#generate-btn');
await page.waitForSelector('.msg-bot .prompt-block[data-lang=fa]:visible');
assert.equal(await page.textContent('.msg-user .bubble'), SRC);
assert.equal(freeRequests.length, 1);
assert.equal(freeRequests[0].source, SRC);
assert.equal(freeRequests[0].type, 'auto', 'default prompt type is auto');
assert.deepEqual(Object.keys(freeRequests[0]).sort(), ['detail', 'lang', 'source', 'type']);
assert.equal(requests.length, 0, 'no Claude call on the free engine');
assert.match(await page.textContent('.msg-bot .prompt-block[data-lang=fa] .prompt-text'), /طراح ارشد برند/, 'free result is displayed');
await page.click('.tab[data-tab=en]');
assert.match(await page.textContent('.msg-bot .prompt-block[data-lang=en] .prompt-text'), /senior brand designer/);
await page.waitForSelector('#quota-note:has-text("۱۹")');
assert.match(page.url(), /#\/studio\?p=/, 'thread is bookmarkable');
await page.waitForSelector('.sb-link.active');
step('free engine: generated without API key, result shown in thread, quota updated');

// Settings: switch to Claude with own key (bad key then good key)
await openMenu('a[href="#/settings"]');
await page.waitForSelector('#engine-choice');
assert.ok(!(await page.isVisible('#api-key')), 'Claude fields hidden on the free engine');
await page.click('#engine-choice label.seg:has(input[value=claude])');
await page.fill('#api-key', 'sk-ant-wrong');
await page.click('#test-key');
await page.waitForSelector('.toast-error');
await page.fill('#api-key', 'sk-ant-test');
await page.click('#test-key');
await page.waitForSelector('.toast-success');
await page.click('#api-form button[type=submit]');
step('API key tested and saved');

// Generate with Claude
await page.click('#sb-new');
await page.waitForSelector('.empty-hero:visible');
await page.fill('#source', SRC);
await page.selectOption('#composer select[name=type]', 'image');
await page.click('#generate-btn');
await page.waitForSelector('.msg-bot .thinking');
await page.waitForSelector('.msg-bot .prompt-block[data-lang=fa]:visible');
const req = requests.at(-1);
assert.equal(req.body.model, 'claude-opus-5');
assert.equal(req.body.fallbacks, 'default');
assert.match(req.headers['anthropic-beta'] || '', /server-side-fallback-2026-07-01/);
assert.equal(req.body.output_config.format.type, 'json_schema');
assert.equal(req.body.output_config.effort, 'medium');
assert.equal(req.body.stream, true);
assert.match(req.body.messages[0].content, /Prompt type: image/);
assert.match(req.body.system, /never a copy/);
assert.ok(req.headers['anthropic-dangerous-direct-browser-access']);
assert.equal(await page.textContent('.result-title'), 'لوگوی مینیمال کافه');
step('prompt generated with Claude (request shape verified)');

// Archive it
await page.click('#archive-btn');
await page.fill('#archive-form input[name=category]', 'طراحی');
await page.fill('#archive-form input[name=tags]', 'لوگو, کافه');
await page.fill('#archive-form textarea[name=notes]', 'برای مشتری');
await page.click('.modal-foot button:has-text("ذخیره")');
await page.waitForSelector('#archive-btn.on');
step('saved to archive with folder and tags');

// Second generation from the thread (stays history-only)
await page.fill('#source', 'write a python script to rename files');
await page.selectOption('#composer select[name=type]', 'coding');
await page.selectOption('#composer select[name=lang]', 'en');
await page.click('#generate-btn');
await page.waitForFunction(() => {
  const blocks = document.querySelectorAll('.msg-bot .prompt-block');
  return blocks.length === 1 && blocks[0].dataset.lang === 'en';
});
assert.equal(requests.at(-1).body.messages[0].content.includes('English only'), true);
await page.waitForFunction(() => document.querySelectorAll('.sb-link').length === 3, null, { timeout: 5000 }).catch(() => {});
assert.equal(await page.locator('.sb-link').count(), 3, 'sidebar lists recent prompts');

// History (search page)
await page.click('.sb-nav a[href="#/history"]');
await page.waitForSelector('.prompt-card');
assert.equal(await page.locator('.prompt-card').count(), 3);
await page.fill('#history-q', 'python');
await page.waitForFunction(() => document.querySelectorAll('.prompt-card').length === 1);
await page.fill('#history-q', 'كافه'); // Arabic kaf must still match Persian "کافه"
await page.waitForFunction(() => document.querySelectorAll('.prompt-card').length === 2);
step('history lists all, folded Persian search works');

// Archive search & filters
await page.click('.sb-nav a[href="#/archive"]');
await page.waitForSelector('#filters');
await page.waitForSelector('#archive-list .prompt-card');
assert.equal(await page.locator('.prompt-card').count(), 1);
await page.fill('#filters input[name=q]', 'مشتری');
await page.waitForTimeout(300);
assert.equal(await page.locator('.prompt-card').count(), 1);
await page.fill('#filters input[name=q]', 'ناموجود');
await page.waitForSelector('.empty');
await page.fill('#filters input[name=q]', '');
await page.click('.tag-cloud .chip[data-tag="لوگو"]');
await page.waitForTimeout(100);
assert.equal(await page.locator('.prompt-card').count(), 1);
assert.match(page.url(), /tag=/);
await page.click('#toggle-advanced');
await page.selectOption('#filters select[name=type]', 'coding');
await page.waitForSelector('.empty');
await page.selectOption('#filters select[name=type]', '');
await page.selectOption('#filters select[name=range]', 'today');
await page.waitForSelector('#archive-list .prompt-card');
assert.match(page.url(), /range=today/);
await page.click('#reset-filters');
await page.waitForSelector('.prompt-card');
step('archive keyword, tag and type filters work');

// Detail modal + favorite
await page.click('.prompt-card [data-act=fav]');
await page.click('.prompt-card h3');
await page.waitForSelector('.modal .detail');
await page.keyboard.press('Escape');
await page.waitForSelector('.modal-backdrop', { state: 'detached' });

// Sidebar link reopens a saved thread
await page.click('.sb-link >> nth=0');
await page.waitForSelector('.msg-bot .result-title');

// Profile: avatar upload + password change
await openMenu('a[href="#/profile"]');
await page.waitForSelector('#avatar-input', { state: 'attached' });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
await page.setInputFiles('#avatar-input', { name: 'a.png', mimeType: 'image/png', buffer: png });
await page.waitForSelector('#avatar-slot img.avatar');
await page.fill('#password-form input[name=old]', 'secret123');
await page.fill('#password-form input[name=new]', 'secret456');
await page.click('#password-form button');
await page.waitForSelector('.toast-success:has-text("رمز")');
step('avatar uploaded, password changed');

// Logout / email-first login with new password; data persists
await page.click('#logout-btn');
await page.waitForSelector('.empty-hero');
await page.click('.sidebar [data-login]');
await page.fill('#auth-form input[name=email]', 'test@example.com');
await page.click('#auth-form button[type=submit]');
await page.waitForSelector('#auth-form input[name=password]:visible');
assert.ok(!(await page.isVisible('#auth-form input[name=name]')), 'existing account goes to the password step');
await page.fill('#auth-form input[name=password]', 'secret123');
await page.click('#auth-form button[type=submit]');
await page.waitForSelector('.form-error:not([hidden])');
await page.fill('#auth-form input[name=password]', 'secret456');
await page.click('#auth-form button[type=submit]');
await page.waitForSelector('.modal-backdrop', { state: 'detached' });
await page.goto(`${BASE}#/archive`);
await page.waitForSelector('.prompt-card');
step('logout/login with new password; still signed in after reload');

// Forgot password with the recovery code
await openMenu('[data-act=logout]');
await page.click('.sidebar [data-login]');
await page.fill('#auth-form input[name=email]', 'test@example.com');
await page.click('#auth-form button[type=submit]');
await page.click('#forgot-link');
await page.fill('#auth-form input[name=code]', 'AAAA-BBBB-CCCC');
await page.fill('#auth-form input[name=password]', 'newpass789');
await page.click('#auth-form button[type=submit]');
await page.waitForSelector('.form-error:not([hidden])');
await page.fill('#auth-form input[name=code]', recoveryCode.toLowerCase());
await page.click('#auth-form button[type=submit]');
await page.waitForSelector('.recovery-code');
const newCode = (await page.textContent('.recovery-code')).trim();
assert.notEqual(newCode, recoveryCode, 'recovery code rotates after use');
await page.click('.modal-foot button:has-text("ذخیره کردم")');
await page.waitForSelector('#user-menu-btn');
step('forgot password: wrong code rejected, right code resets and signs in');

// Pinned prompts: pin from the sidebar, open pinned/recent flyouts from the rail, unpin from the thread
await page.hover('#sb-recent .sb-row');
await page.click('#sb-recent .sb-row .sb-pin');
await page.waitForSelector('#sb-recent .sb-pinned .sb-link');
assert.equal(await page.textContent('#sb-recent .sb-pinned h3'), 'پین‌شده‌ها');
assert.equal(await page.locator('#sb-recent .sb-pinned .sb-link').count(), 1);
const pinnedTitle = (await page.textContent('#sb-recent .sb-pinned .sb-link span')).trim();
assert.ok(!(await page.isVisible('[data-flyout="recent"]')), 'rail-only buttons hidden while the sidebar is open');
await page.click('.sb-toggle');
await page.waitForTimeout(300);
await page.click('[data-flyout="recent"]');
await page.waitForSelector('.sb-flyout a');
const fly = await page.evaluate(() => {
  const r = document.querySelector('.sb-flyout').getBoundingClientRect();
  const s = document.querySelector('.sidebar').getBoundingClientRect();
  return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: innerWidth, h: innerHeight, sbLeft: s.left, n: document.querySelectorAll('.sb-flyout a').length, over: document.documentElement.scrollWidth - innerWidth };
});
assert.ok(fly.n >= 1 && fly.n <= 10, `recent flyout lists at most 10: ${fly.n}`);
assert.ok(fly.l >= 0 && fly.t >= 0 && fly.r <= fly.w && fly.b <= fly.h, `flyout on screen: ${JSON.stringify(fly)}`);
assert.ok(fly.r <= fly.sbLeft, `flyout opens beside the rail, toward the content: ${JSON.stringify(fly)}`);
assert.ok(fly.over <= 0, 'flyout adds no horizontal scroll');
await page.click('[data-flyout="recent"]');
await page.waitForSelector('.sb-flyout', { state: 'detached' });
await page.click('[data-flyout="pinned"]');
await page.waitForSelector('.sb-flyout a');
assert.equal(await page.locator('.sb-flyout a').count(), 1);
await page.keyboard.press('Escape');
await page.waitForSelector('.sb-flyout', { state: 'detached' });
await page.click('[data-flyout="pinned"]');
await page.click('.sb-flyout a');
await page.waitForSelector('.sb-flyout', { state: 'detached' });
await page.waitForSelector('#pin-btn.on');
assert.equal((await page.textContent('.result-title')).trim().slice(0, 10), pinnedTitle.slice(0, 10));
await page.click('.sb-toggle');
await page.waitForTimeout(300);
await page.click('#pin-btn');
await page.waitForSelector('#pin-btn:not(.on)');
await page.waitForSelector('#sb-recent .sb-pinned', { state: 'detached' });
step('pin prompts; rail pinned/recent flyouts open beside the rail');

// Regression: hovering the avatar in the collapsed rail must not make the page scroll (it used to flicker)
await page.click('.sb-toggle');
await page.waitForTimeout(300);
await page.hover('#user-menu-btn');
const heights = await page.evaluate(async () => { const out = []; for (let i = 0; i < 10; i += 1) { out.push(document.documentElement.scrollHeight - innerHeight); await new Promise((r) => setTimeout(r, 12)); } return out; });
assert.ok(heights.every((h) => h <= 0), `no page overflow while the tooltip appears: ${heights}`);
await page.waitForSelector('.tooltip');
const tipBox = await page.evaluate(() => { const r = document.querySelector('.tooltip').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: innerWidth, h: innerHeight }; });
assert.ok(tipBox.l >= 0 && tipBox.t >= 0 && tipBox.r <= tipBox.w && tipBox.b <= tipBox.h, `tooltip fully on screen: ${JSON.stringify(tipBox)}`);
assert.equal(await page.textContent('.tooltip'), 'رسول تست');
await page.mouse.move(600, 300);
await page.waitForSelector('.tooltip', { state: 'detached' });
await page.click('.sb-toggle');
await page.waitForTimeout(300);
step('rail tooltip does not overflow the page');

// Google sign-in creates a separate account
await openMenu('[data-act=logout]');
await page.click('.topbar [data-login="login"]');
await page.click('#gsi-stub');
await page.waitForSelector('#user-menu-btn:has-text("مریم گوگلی")');
await openMenu('a[href="#/profile"]');
await page.waitForSelector('#password-form');
assert.equal(await page.locator('#password-form input[name=old]').count(), 0, 'Google account sets a password without an old one');
assert.equal(await page.textContent('.stats strong'), '۰', 'Google account starts empty');
step('Google sign-in works and creates its own account');

// What's new: a returning user sees the changes since their last visit once
await page.evaluate(() => { localStorage.setItem('pc.whatsNewSeen', '1'); location.hash = '#/studio'; });
await page.waitForSelector('#composer');
await page.reload();
await page.waitForSelector('.modal-news .changelog-entry li');
assert.equal(await page.textContent('#modal-title'), 'تازه‌های این نسخه');
await page.click('.modal-news [data-action="0"]');
await page.waitForSelector('.modal-backdrop', { state: 'detached' });
await page.reload();
await page.waitForSelector('#composer');
await page.waitForTimeout(900);
assert.equal(await page.locator('.modal-news').count(), 0, 'shown only once');
await openMenu('[data-act=news]');
await page.waitForSelector('.modal-news .changelog-entry');
await page.keyboard.press('Escape');
await page.waitForSelector('.modal-backdrop', { state: 'detached' });
step("what's new shown once after an update, and from the account menu");

// Mobile layout: drawer sidebar
await page.setViewportSize({ width: 390, height: 800 });
await page.goto(`${BASE}#/studio`);
await page.waitForSelector('#composer');
await page.waitForTimeout(400); // let the sidebar finish sliding off-canvas after the resize
assert.ok(await page.isVisible('.tb-menu'), 'menu button on mobile');
const offscreen = async () => page.evaluate(() => { const r = document.querySelector('.sidebar').getBoundingClientRect(); return r.left >= window.innerWidth - 1 || r.right <= 1; });
assert.ok(await offscreen(), 'sidebar hidden off-canvas');
await page.click('.tb-menu');
await page.waitForFunction(() => document.body.classList.contains('drawer-open'));
await page.waitForTimeout(350);
assert.ok(!(await offscreen()), 'drawer opens');
await page.click('#scrim', { position: { x: 20, y: 400 } });
await page.waitForFunction(() => !document.body.classList.contains('drawer-open'));
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
assert.equal(overflow, false, 'no horizontal scroll on mobile');
step('mobile layout: drawer sidebar, no horizontal overflow');

// Android browser: dismissible "get the app" banner; never shown inside the app itself
const android = await browser.newContext({ viewport: { width: 390, height: 800 }, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
const ap = await android.newPage();
await ap.goto(BASE);
await ap.waitForSelector('#app-banner');
await ap.click('#app-banner-close');
await ap.waitForSelector('#app-banner', { state: 'detached' });
await ap.reload();
await ap.waitForSelector('#composer');
assert.equal(await ap.locator('#app-banner').count(), 0, 'banner stays dismissed');
await android.close();
const inApp = await browser.newContext({ userAgent: 'Mozilla/5.0 (Linux; Android 14; wv) Chrome/130.0 Mobile PromptSazApp' });
const ip = await inApp.newPage();
await ip.goto(BASE);
await ip.waitForSelector('#composer');
assert.equal(await ip.locator('#app-banner, a[href="#/app"]').count(), 0, 'no download prompts inside the app');
await inApp.close();
step('Android banner shown in browsers, dismissible, hidden in the app');

// Android app with the native plugin: update prompt for a newer APK, and native Google sign-in
const newApp = await browser.newContext({ viewport: { width: 390, height: 800 }, userAgent: 'Mozilla/5.0 (Linux; Android 14; wv) Chrome/130.0 Mobile PromptSazApp/5' });
await newApp.route(/assets\/js\/config\.js/, (r) => r.fulfill({ contentType: 'text/javascript', body: CONFIG_JS }));
await newApp.route(/assets\/android-version\.json/, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ versionCode: 7, versionName: '1.0.7', apkUrl: 'https://github.com/x/y.apk' }) }));
await newApp.addInitScript((token) => {
  window.Capacitor = { Plugins: {
    SocialLogin: {
      initialize: async () => ({}),
      login: async () => ({ provider: 'google', result: { idToken: token } }),
    },
  } };
}, idToken);
const np = await newApp.newPage();
np.on('pageerror', (e) => errors.push(`app: ${e.message}`));
await np.goto(BASE);
await np.waitForSelector('.modal-news .update-hero');
assert.equal(await np.textContent('#modal-title'), 'نسخه جدید اپ آماده است');
await np.click('.modal-news [data-action="0"]');
await np.waitForSelector('.modal-backdrop', { state: 'detached' });
await np.reload();
await np.waitForSelector('#composer');
await np.waitForTimeout(900);
assert.equal(await np.locator('.modal-news').count(), 0, '"later" snoozes the update prompt');
await np.click('.topbar [data-login="login"]');
await np.waitForSelector('#google-slot.ready .google-native');
await np.click('.google-native');
await np.waitForSelector('#user-menu-btn[data-tip="مریم گوگلی"]', { state: 'attached' });
await newApp.close();
const oldApp = await browser.newContext({ userAgent: 'Mozilla/5.0 (Linux; Android 14; wv) Chrome/130.0 Mobile PromptSazApp' });
const op = await oldApp.newPage();
await op.goto(BASE);
await op.click('.topbar [data-login="login"]');
await op.waitForSelector('#auth-form');
assert.equal(await op.locator('#google-slot').count(), 0, 'old APK without the plugin: no Google button');
await oldApp.close();
step('Android app: update prompt for a newer APK, native Google sign-in');

assert.deepEqual(errors, [], `page errors: ${errors.join('\n')}`);
await browser.close();
console.log('\nAll checks passed.');
