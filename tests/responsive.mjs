// Responsive check: every page, both sidebar states and many viewport sizes (with real scrollbars) must have
// no horizontal overflow, the empty studio must fit vertically, and rail tooltips must stay fully on screen.
// Usage: serve the repo on :8765, then node tests/responsive.mjs
import { chromium } from 'playwright';
const b = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
const sizes = [[1912,843],[1920,1080],[1366,768],[1280,720],[1024,768],[900,700],[768,1024],[600,900],[414,896],[390,844],[360,640],[320,568]];
const pages = ['#/studio','#/help','#/rules','#/app','#/history','#/archive','#/settings','#/profile'];
const report = [];
const ctx = await b.newContext();
await ctx.route(/assets\/js\/config\.js/, r => r.fulfill({ contentType:'text/javascript', body:"export const GOOGLE_CLIENT_ID='';export const FREE_API_URL='';export const ANDROID_APK_URL='x';export const ANDROID_RELEASES_URL='y';" }));
const p = await ctx.newPage();
await p.goto('http://localhost:8765/'); await p.waitForSelector('#composer');
// sign up so protected pages render
await p.click('.topbar [data-login="login"]');
await p.fill('#auth-form input[name=email]','a@b.co'); await p.click('#auth-form button[type=submit]');
await p.fill('#auth-form input[name=name]','محمد رسول مرادی نژاد'); await p.fill('#auth-form input[name=password]','secret123'); await p.click('#auth-form button[type=submit]');
await p.waitForSelector('.recovery-code'); await p.click('.modal-foot button'); await p.waitForSelector('.modal-backdrop',{state:'detached'});
const measure = () => p.evaluate(() => {
  const d = document.documentElement;
  const ox = d.scrollWidth - innerWidth, oy = d.scrollHeight - innerHeight;
  const culprits = [];
  if (ox > 0) for (const el of document.querySelectorAll('body *')) { const r = el.getBoundingClientRect(); if (r.width && (r.right > innerWidth + 1 || r.left < -1)) culprits.push((el.id ? '#' + el.id : el.className.baseVal ?? el.className) + ` [${Math.round(r.left)},${Math.round(r.right)}]`); }
  return { ox, oy, culprits: culprits.slice(0, 6) };
});
for (const [w,h] of sizes) {
  await p.setViewportSize({ width: w, height: h });
  for (const closed of [false, true]) {
    await p.evaluate((c) => document.body.classList.toggle('sidebar-closed', c), closed);
    for (const pg of pages) {
      await p.goto('http://localhost:8765/' + pg); await p.waitForTimeout(250);
      const m = await measure();
      if (m.ox > 0) report.push(`${w}x${h} ${closed?'rail':'open'} ${pg} OVERFLOW-X ${m.ox}px ${m.culprits.join(' | ')}`);
      if (pg === '#/studio' && m.oy > 0) report.push(`${w}x${h} ${closed?'rail':'open'} ${pg} OVERFLOW-Y ${m.oy}px`);
      if (closed && w > 860 && pg === '#/studio') {
        for (const sel of ['.sb-toggle', '#sb-new', '.sb-secondary a[href="#/app"]', '.sb-secondary a[href="#/rules"]', '#user-menu-btn']) {
          await p.hover(sel);
          const samples = [];
          for (let i = 0; i < 8; i++) { samples.push(await measure()); await p.waitForTimeout(15); }
          const worst = samples.reduce((a, s) => ({ ox: Math.max(a.ox, s.ox), oy: Math.max(a.oy, s.oy) }), { ox: 0, oy: 0 });
          const tip = await p.evaluate((s) => { const el = document.querySelector(s); const cs = getComputedStyle(el, '::after'); const r = el.getBoundingClientRect(); return { top: r.top, h: parseFloat(cs.height), bottomCss: cs.bottom, topCss: cs.top }; }, sel);
          const tb = await p.evaluate(() => { const t = document.querySelector('.tooltip'); if (!t) return null; const r = t.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; });
          if (tb !== true) report.push(`${w}x${h} rail hover ${sel} tooltip ${tb === null ? 'MISSING' : 'OFF-SCREEN'}`);
          if (worst.ox > 0 || worst.oy > 0) report.push(`${w}x${h} rail hover ${sel} overflow x=${worst.ox} y=${worst.oy} tip=${JSON.stringify(tip)}`);
        }
        await p.mouse.move(w / 2, h / 2);
      }
    }
  }
}
console.log(report.length ? report.join('\n') : 'Responsive check passed.');
if (report.length) process.exitCode = 1;
await b.close();
