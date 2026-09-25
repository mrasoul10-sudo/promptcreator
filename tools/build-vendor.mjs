// Rebuilds assets/vendor/anthropic-sdk.js: the official Anthropic TypeScript SDK bundled
// into one browser ES module, so the site has no runtime CDN or build dependency.
// Usage: npm install && npm run build:vendor

import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../node_modules/@anthropic-ai/sdk/package.json', import.meta.url)));

await build({
  stdin: { contents: 'export { default, Anthropic } from "@anthropic-ai/sdk";', resolveDir: process.cwd() },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  minify: true,
  legalComments: 'none',
  banner: { js: `/* @anthropic-ai/sdk v${version} (MIT) — bundled by tools/build-vendor.mjs */` },
  outfile: 'assets/vendor/anthropic-sdk.js',
});

console.log(`Bundled @anthropic-ai/sdk v${version} -> assets/vendor/anthropic-sdk.js`);
