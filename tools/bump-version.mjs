// Cache-busting: stamps a new ?v=<version> on every local CSS/JS reference (index.html and ES module imports),
// so browsers fetch fresh files after each deploy instead of mixing cached old modules with new ones.
// Usage: npm run bump   (run before committing any change under assets/)

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const version = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12); // YYYYMMDDhhmm (UTC)
const root = new URL('..', import.meta.url).pathname;

function stamp(file, pattern) {
  const path = join(root, file);
  const before = readFileSync(path, 'utf8');
  const after = before.replace(pattern, (_m, spec) => `${spec}?v=${version}`);
  if (after !== before) writeFileSync(path, after);
}

// index.html: <link href="assets/css/app.css"> and <script src="assets/js/app.js">
stamp('index.html', /(assets\/(?:css|js)\/[\w-]+\.(?:css|js))(?:\?v=[\w.-]*)?/g);

// Relative ES module imports: from './x.js' and from '../vendor/x.js'
for (const name of readdirSync(join(root, 'assets/js'))) {
  if (name.endsWith('.js')) stamp(`assets/js/${name}`, /(\.\.?\/[\w/-]+\.js)(?:\?v=[\w.-]*)?(?=['"])/g);
}

console.log(`Stamped asset version ${version}`);
