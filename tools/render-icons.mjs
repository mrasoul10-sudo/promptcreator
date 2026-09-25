// Renders the SVG logo into the PNG icons used by the web manifest, iOS and the Android app.
// Usage: node tools/render-icons.mjs   (needs Playwright/Chromium)

import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const logo = readFileSync(`${root}assets/img/app-icon.svg`, 'utf8'); // rounded-square app icon
const maskable = readFileSync(`${root}assets/img/logo-maskable.svg`, 'utf8');
const out = `${root}assets/img/icons`;
mkdirSync(out, { recursive: true });

const jobs = [
  ['icon-192.png', logo, 192, true],
  ['icon-512.png', logo, 512, true],
  ['icon-1024.png', logo, 1024, true],
  ['apple-touch-icon.png', maskable, 180, false],
  ['maskable-512.png', maskable, 512, false],
  ['maskable-1024.png', maskable, 1024, false],
];

// Android (Capacitor assets): adaptive icon layers, legacy icon and splash screens.
// Foreground: the logo inside the adaptive-icon safe zone, over the navy background layer.
const symbol = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g transform="translate(16.0 16.0) scale(0.5)"><path d="M11.985 47.638A25.4 25.4 0 0 1 32.0 6.6 M52.015 16.362A25.4 25.4 0 0 1 32.0 57.4" fill="none" stroke="#0A72B5" stroke-width="1.1"/><path d="M32.0 8.4A23.6 23.6 0 0 1 43.8 11.562 M32.0 55.6A23.6 23.6 0 0 1 20.2 52.438" fill="none" stroke="#0A72B5" stroke-width="4.6"/><path d="M46.972 20.302A19 19 0 0 1 22.5 48.454 M17.028 43.698A19 19 0 0 1 41.5 15.546" fill="none" stroke="#0BBEF2" stroke-width="5.2"/></g></svg>`;
const solid = (color) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${color}"/></svg>`;
const splash = (bg) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2732 2732"><rect width="2732" height="2732" fill="${bg}"/><g transform="translate(1110 1110) scale(8)">${logo.replace(/<\/?svg[^>]*>/g, '')}</g></svg>`;
const androidOut = `${root}app-android/assets`;
mkdirSync(androidOut, { recursive: true });
const androidJobs = [
  ['icon-only.png', maskable, 1024, false],
  ['icon-foreground.png', symbol, 1024, true],
  ['icon-background.png', solid('#060B14'), 1024, false],
  // Launch screen: the logo alone, drawn by Android at its own size in the middle of a plain background (android.yml).
  ['splash-logo.png', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g transform="translate(12.8 12.8) scale(0.6)"><path d="M11.985 47.638A25.4 25.4 0 0 1 32.0 6.6 M52.015 16.362A25.4 25.4 0 0 1 32.0 57.4" fill="none" stroke="#0A72B5" stroke-width="1.1"/><path d="M32.0 8.4A23.6 23.6 0 0 1 43.8 11.562 M32.0 55.6A23.6 23.6 0 0 1 20.2 52.438" fill="none" stroke="#0A72B5" stroke-width="4.6"/><path d="M46.972 20.302A19 19 0 0 1 22.5 48.454 M17.028 43.698A19 19 0 0 1 41.5 15.546" fill="none" stroke="#0BBEF2" stroke-width="5.2"/></g></svg>`, 1152, true],
  ['splash.png', splash('#ffffff'), 2732, false],
  ['splash-dark.png', splash('#212121'), 2732, false],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, svg, size, transparent] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: `${out}/${name}`, omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', name);
}
for (const [name, svg, size, transparent] of androidJobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: `${androidOut}/${name}`, omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote android', name);
}
await browser.close();
