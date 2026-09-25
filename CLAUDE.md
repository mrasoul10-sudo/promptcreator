# CLAUDE.md

Guidance for AI coding agents (Claude Code and others) working in this repository.

## What this is

**Prompt Creator** is a bilingual (Persian/English) web app that rewrites a user's rough idea into a professional AI prompt, in English, Persian, or both. By default it uses a **free service** (Gemini behind a small Cloudflare Worker in `worker/`, no key for visitors, daily limits); users can instead choose **Claude with their own API key**. Every generation is saved to **history**, and the user can keep prompts in an **archive** with folders, tags, notes, favorites and advanced search. The home page (studio) is open to guests; signing in is asked for in a dialog only when they generate or open another page. Accounts are local (email/password with a one-time recovery code, or **Sign in with Google**), with avatar and password change.

The site is **static** on **GitHub Pages**. All user data lives in the visitor's browser (IndexedDB). The only server code is the stateless prompt proxy in `worker/` (Cloudflare Worker + a Durable Object for daily quotas); it holds the Gemini key and stores no user content. In Claude mode the browser calls the Claude API directly with the user's own key.

## Hard constraints

- **No backend for the site, no build step.** The page must stay deployable by serving the repo root as static files. Do not add a framework or bundler step. Server code lives only in `worker/` and must stay a stateless proxy: never store prompts or accounts there, never put the Gemini key anywhere but the `GEMINI_API_KEY` secret, and keep the per-visitor/global/per-minute limits.
- **One prompt spec.** The system prompt, per-type guidance, output schema and result parsing live in `assets/js/prompt-spec.js`, imported by both `engine.js` and `worker/src/index.js`. Change prompting there only; the worker accepts only `{source, type, lang, detail}`, never a client-supplied prompt, so it cannot be used as a general free LLM.
- **No runtime CDN scripts.** The only third-party runtime code is `assets/vendor/anthropic-sdk.js`, the official SDK bundle, committed to the repo. Rebuild it with `npm run build:vendor`; never hand-edit it.
- **Claude calls go through the official SDK** (`@anthropic-ai/sdk`) in `assets/js/engine.js`, never raw `fetch`.
- **CSP** in `index.html` allows scripts from `'self'` plus Google's GSI client, styles from `'self'`, Google Fonts and GSI, frames from `accounts.google.com` only, and `connect-src` to `https://*.workers.dev`, `https://api.anthropic.com` and `accounts.google.com` (Google sign-in uses FedCM). Keep it that tight. Do not add inline `<script>`, inline `style="..."` attributes in HTML strings, or `eval`. Set dynamic styles via the CSSOM (`el.style.x = ...`) instead.
- **RTL-first UI** in Persian (`<html lang="fa" dir="rtl">`). Use logical CSS properties (`inset-inline-start`, `margin-inline-end`, `padding-inline-*`). User text fields use `dir="auto"`. English prompt output renders `dir="ltr"`.
- **Escape all user and model content.** Build HTML with `esc()` from `ui.js` or set `textContent`. Search highlighting goes through `highlight()`, which escapes first.
- Keep it lightweight: vanilla ES modules, no new runtime dependencies.

## Layout

```
index.html              App shell, CSP, font and script includes
assets/css/app.css      Design system: tokens (light/dark), layout, components, animations
assets/js/app.js        Hash router + all views (auth, studio, history, archive, profile, settings)
assets/js/engine.js     Engine selection: free service (worker/) or Claude with the user's key; error translation
assets/js/prompt-spec.js Shared system prompt, per-type guidance, JSON schema, option/result normalization
assets/js/prompts.js    Prompt records CRUD, archive, search/filter/sort, facets, backup import/export
assets/js/auth.js       Local accounts (PBKDF2), Google sign-in linking, recovery codes, session, profile/settings, avatar
assets/js/google.js     Google Identity Services loader, button, ID-token parsing
assets/js/config.js     Public site config: GOOGLE_CLIENT_ID, FREE_API_URL (set by the deploy workflow)
worker/                 Cloudflare Worker: POST /generate (Gemini), GET /quota, GET /health; Quota Durable Object
.github/workflows/deploy-worker.yml  Tests + deploys worker/, then writes its URL into config.js
assets/js/db.js         IndexedDB promise wrapper (stores: users, prompts)
assets/js/ui.js         esc, icons, toasts, modal, clipboard, date formatting (fa-IR/Jalali)
assets/vendor/          Bundled Anthropic SDK (generated)
tests/e2e.mjs           Playwright end-to-end test with mocked free service, Claude API and Google
tests/worker.test.mjs   Worker unit test in plain Node (mocked Gemini, fake Durable Object)
tools/build-vendor.mjs  Rebuilds the SDK bundle
tools/bump-version.mjs  Stamps ?v=<version> on asset URLs and module imports (cache-busting)
docs/                   Architecture, prompt engine, deployment, user guide
```

## Run locally

```bash
python3 -m http.server 8765        # or: npm run serve
# open http://localhost:8765/
```

ES modules and WebCrypto require `http://localhost` or HTTPS; opening `index.html` from `file://` will not work.

## Test

```bash
npm install                        # dev tools only: SDK source, esbuild, playwright
npm run serve &                    # serve on :8765
npm run test:e2e                   # headless Chromium, all external APIs mocked, no key needed
npm run test:worker                # worker logic: request shape, fallback model, quotas, refunds
```

The e2e test covers register, API key test, generation (and asserts the exact request shape: model, `fallbacks`, beta header, `output_config`), archive save, history search including Arabic/Persian letter folding, archive filters, avatar upload, password change, re-login persistence and the mobile layout. Run it after any change to JS or CSS.

## Conventions

- **Cache-busting:** every local CSS/JS reference carries `?v=<version>` (index.html and all relative `import` specifiers). After changing anything under `assets/`, run `npm run bump` before committing, otherwise returning visitors can get a mix of cached old and new modules. Always write new imports as `'./x.js'`; the bump script adds the version.

- UI strings are Persian and written inline in the views; there is no i18n layer.
- Routes are `#/studio` (public home), `#/history`, `#/archive`, `#/profile`, `#/settings` (need sign-in: a guest is kept on the studio, the auth dialog opens, and on success they are sent to the page they asked for). There are no login pages; `openAuthModal()` is the only sign-in UI. Filters are mirrored into the hash query string (bookmarkable) via `syncQuery()` without re-routing.
- Every generation is stored immediately as a prompt record with `archived: false`. Archiving sets `archived: true` plus metadata. Deleting from history deletes the record everywhere.
- The default engine is the free service (`settings.engine = 'free'`); it needs `FREE_API_URL` in `config.js`. The worker uses `GEMINI_MODEL` (default alias `gemini-flash-latest`) with `GEMINI_FALLBACK_MODEL` when busy; both are vars in `worker/wrangler.toml`.
- In Claude mode the default model is `claude-opus-5` with `output_config.effort: "medium"`, structured JSON output (`output_config.format` with a JSON schema), and server-side refusal fallbacks (`fallbacks: "default"` + beta `server-side-fallback-2026-07-01`) on Opus. Streaming is used with `finalMessage()` to avoid HTTP timeouts. See `docs/PROMPT_ENGINE.md` before changing any of this.
- The IndexedDB schema version is `DB_VERSION` in `db.js`. Add migrations in `onupgradeneeded`; never drop user data.

## Deployment

GitHub Pages, "Deploy from a branch", root folder. See `docs/DEPLOYMENT.md`. `.nojekyll` must stay at the root.
