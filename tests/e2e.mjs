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

const browser = await chromium.launch();
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
await context.route(/assets\/js\/config\.js/, (r) => r.fulfill({ contentType: 'text/javascript', body: `export const GOOGLE_CLIENT_ID = '${GOOGLE_ID}';` }));
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = `${b64url({ alg: 'none' })}.${b64url({ iss: 'https://accounts.google.com', aud: GOOGLE_ID, sub: 'g-123', email: 'maryam@gmail.com', email_verified: true, name: 'مریم گوگلی', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
await context.route('https://accounts.google.com/gsi/client', (r) => r.fulfill({
  contentType: 'text/javascript',
  body: `window.google = { accounts: { id: {
    initialize(c) { this.cb = c.callback; },
    renderButton(el) { const b = document.createElement('button'); b.type = 'button'; b.id = 'gsi-stub'; b.textContent = 'Continue with Google'; b.onclick = () => this.cb({ credential: ${JSON.stringify(idToken)} }); el.appendChild(b); },
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
  const isCode = body.messages[0].content.includes('python');
  const out = JSON.stringify(isCode ? {
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
  });
  return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse(body.model, out) });
});

const step = (name) => console.log(`• ${name}`);

// Guest home: writing is open, generating asks to sign in
await page.goto(BASE);
await page.waitForSelector('#composer');
assert.ok(await page.isVisible('.hero'), 'guest hero on home page');
assert.ok(!(await page.isVisible('#auth-form')), 'no login form up front');
await page.fill('#source', 'یک لوگو برای کافه با رنگ های گرم میخوام');
await page.click('#generate-btn');
await page.waitForSelector('.modal #auth-form');
step('guest can write on home; generate opens sign-in dialog');

// Protected page as guest opens the dialog too
await page.keyboard.press('Escape');
await page.waitForSelector('.modal-backdrop', { state: 'detached' });
await page.click('a.nav-link[href="#/archive"]');
await page.waitForSelector('.modal #auth-form');
assert.match(page.url(), /#\/studio/);

// Register inside the dialog
await page.click('.auth-tabs .tab[data-mode=register]');
await page.fill('#auth-form input[name=name]', 'رسول تست');
await page.fill('#auth-form input[name=email]', 'Test@Example.com');
await page.fill('#auth-form input[name=password]', 'secret123');
await page.click('#auth-form button[type=submit]');
await page.waitForSelector('.recovery-code');
const recoveryCode = (await page.textContent('.recovery-code')).trim();
assert.match(recoveryCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
await page.click('.modal-foot button:has-text("ذخیره کردم")');
await page.waitForSelector('.prompt-card, .empty');
assert.match(page.url(), /#\/archive/, 'returns to the page that asked for sign-in');
await page.click('a.nav-link[href="#/studio"]');
await page.waitForSelector('#composer');
assert.equal(await page.inputValue('#source'), 'یک لوگو برای کافه با رنگ های گرم میخوام', 'draft kept');
assert.ok(await page.isVisible('.banner'), 'API key banner should show');
step('registered in dialog, got recovery code, returned to archive, draft kept');

// Settings: bad key then good key
await page.click('a.nav-link[href="#/settings"]');
await page.fill('#api-key', 'sk-ant-wrong');
await page.click('#test-key');
await page.waitForSelector('.toast-error');
await page.fill('#api-key', 'sk-ant-test');
await page.click('#test-key');
await page.waitForSelector('.toast-success');
await page.click('#api-form button[type=submit]');
step('API key tested and saved');

// Generate
await page.click('a.nav-link[href="#/studio"]');
await page.fill('#source', 'یک لوگو برای کافه با رنگ های گرم میخوام');
await page.click('label.seg:has(input[value=image])');
await page.click('#generate-btn');
await page.waitForSelector('.result .prompt-block[data-lang=en]');
const req = requests.at(-1);
assert.equal(req.body.model, 'claude-opus-5');
assert.equal(req.body.fallbacks, 'default');
assert.match(req.headers['anthropic-beta'] || '', /server-side-fallback-2026-07-01/);
assert.equal(req.body.output_config.format.type, 'json_schema');
assert.equal(req.body.output_config.effort, 'medium');
assert.equal(req.body.stream, true);
assert.match(req.body.messages[0].content, /Prompt type: image/);
assert.ok(req.headers['anthropic-dangerous-direct-browser-access']);
assert.equal(await page.textContent('.result h2'), 'لوگوی مینیمال کافه');
step('prompt generated (request shape verified)');

// Archive it
await page.click('#archive-btn');
await page.fill('#archive-form input[name=category]', 'طراحی');
await page.fill('#archive-form input[name=tags]', 'لوگو, کافه');
await page.fill('#archive-form textarea[name=notes]', 'برای مشتری');
await page.click('.modal-foot button:has-text("ذخیره")');
await page.waitForSelector('#archive-btn:has-text("در آرشیو")');
step('saved to archive with folder and tags');

// Second generation (stays history-only)
await page.fill('#source', 'write a python script to rename files');
await page.click('label.seg:has(input[value=coding])');
await page.click('label.seg:has(input[value=en])');
await page.click('#generate-btn');
await page.waitForFunction(() => document.querySelectorAll('.result .prompt-block').length === 1);
assert.equal(requests.at(-1).body.messages[0].content.includes('English only'), true);

// History
await page.click('a.nav-link[href="#/history"]');
await page.waitForSelector('.prompt-card');
assert.equal(await page.locator('.prompt-card').count(), 2);
await page.fill('#history-q', 'كافه'); // Arabic kaf must still match Persian "کافه"
await page.waitForFunction(() => document.querySelectorAll('.prompt-card').length === 1);
step('history lists both, folded Persian search works');

// Archive search & filters
await page.click('a.nav-link[href="#/archive"]');
await page.waitForSelector('.prompt-card');
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
await page.click('#reset-filters');
await page.waitForSelector('.prompt-card');
step('archive keyword, tag and type filters work');

// Detail modal + favorite
await page.click('.prompt-card [data-act=fav]');
await page.click('.prompt-card h3');
await page.waitForSelector('.modal .detail');
await page.keyboard.press('Escape');
await page.waitForSelector('.modal-backdrop', { state: 'detached' });

// Profile: avatar upload + password change
await page.click('.user-chip');
await page.waitForSelector('#avatar-input', { state: 'attached' });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
await page.setInputFiles('#avatar-input', { name: 'a.png', mimeType: 'image/png', buffer: png });
await page.waitForSelector('#avatar-slot img.avatar');
await page.fill('#password-form input[name=old]', 'secret123');
await page.fill('#password-form input[name=new]', 'secret456');
await page.click('#password-form button');
await page.waitForSelector('.toast-success:has-text("رمز")');
step('avatar uploaded, password changed');

// Logout / login with new password persists data
await page.click('#logout-btn');
await page.waitForSelector('.hero');
await page.click('.sidebar [data-login]');
await page.fill('#auth-form input[name=email]', 'test@example.com');
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
await page.click('.user-chip');
await page.click('#logout-btn');
await page.click('.sidebar [data-login]');
await page.click('#forgot-link');
await page.fill('#auth-form input[name=email]', 'test@example.com');
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
await page.waitForSelector('.user-chip');
step('forgot password: wrong code rejected, right code resets and signs in');

// Google sign-in creates a separate account
await page.click('.user-chip');
await page.click('#logout-btn');
await page.click('.sidebar [data-login]');
await page.click('#gsi-stub');
await page.waitForSelector('.user-chip:has-text("مریم گوگلی")');
await page.click('.user-chip');
await page.waitForSelector('#password-form');
assert.equal(await page.locator('#password-form input[name=old]').count(), 0, 'Google account sets a password without an old one');
assert.equal(await page.textContent('.stats strong'), '۰', 'Google account starts empty');
step('Google sign-in works and creates its own account');

// Mobile layout
await page.setViewportSize({ width: 390, height: 800 });
await page.goto(`${BASE}#/studio`);
await page.waitForSelector('#composer');
assert.ok(await page.isVisible('.bottom-nav'));
assert.ok(!(await page.isVisible('.sidebar')));
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
assert.equal(overflow, false, 'no horizontal scroll on mobile');
step('mobile layout: bottom nav, no horizontal overflow');

assert.deepEqual(errors, [], `page errors: ${errors.join('\n')}`);
await browser.close();
console.log('\nAll checks passed.');
