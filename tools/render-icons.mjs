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
// Foreground: the white mark inside the adaptive-icon safe zone, over the brand-color background layer.
const symbol = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g transform="translate(15.0 16.0) scale(0.5)"><path d="M12.03 24.85A22 22 0 1 1 28.68 47.35L12.4 60Z" fill="#fff"/><path d="M22.74 35.1A13 13 0 1 1 27.9 40.08L21.8 42.6Z" fill="#6C4CF5"/><path d="M33.05 16.2h1.9v-4.8h-1.9z" fill="#6C4CF5"/><circle cx="34" cy="9.7" r="2.6" fill="#6C4CF5"/><ellipse cx="29.2" cy="29.0" rx="2.4" ry="3.5" fill="#fff"/><ellipse cx="38.8" cy="29.0" rx="2.4" ry="3.5" fill="#fff"/></g></svg>`;
const solid = (color) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${color}"/></svg>`;
const splash = (bg) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2732 2732"><rect width="2732" height="2732" fill="${bg}"/><g transform="translate(1110 1110) scale(8)">${logo.replace(/<\/?svg[^>]*>/g, '')}</g></svg>`;
const androidOut = `${root}app-android/assets`;
mkdirSync(androidOut, { recursive: true });
const androidJobs = [
  ['icon-only.png', maskable, 1024, false],
  ['icon-foreground.png', symbol, 1024, true],
  ['icon-background.png', solid('#6C4CF5'), 1024, false],
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
