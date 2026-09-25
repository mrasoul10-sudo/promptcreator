# CLAUDE.md

Guidance for AI coding agents (Claude Code and others) working in this repository.

## What this is

**Prompt Creator** is a bilingual (Persian/English) web app that rewrites a user's rough idea into a professional AI prompt, in English, Persian, or both. By default it uses a **free service** (Gemini behind a small Cloudflare Worker in `worker/`, no key for visitors, daily limits); users can instead choose **Claude with their own API key**. Every generation is saved to **history**, and the user can keep prompts in an **archive** with folders, tags, notes, favorites and advanced search. The home page (studio) is open to guests; signing in is asked for in a dialog only when they generate or open another page. Accounts are local (email/password with a one-time recovery code, or **Sign in with Google**), with avatar and password change.

The site is **static** on **Cloudflare Pages** (`promptsaz.pages.dev`) and **GitHub Pages**. All user data lives in the visitor's browser (IndexedDB). The only server code is the stateless prompt proxy in `worker/` (Cloudflare Worker + a Durable Object for daily quotas); it holds the Gemini key and stores no user content. In Claude mode the browser calls the Claude API directly with the user's own key.

## Hard constraints

- **No backend for the site, no build step.** The page must stay deployable by serving the repo root as static files. Do not add a framework or bundler step. Server code lives only in `worker/` and must stay a stateless proxy: never store prompts, recordings or accounts there, never put the Gemini key anywhere but the `GEMINI_API_KEY` secret, and keep the per-visitor/global/per-minute limits.
- **Inappropriate-language filter** in `assets/js/moderation.js` (Persian + English profanity, sexual and hateful terms; word-level matching after normalizing Arabic letters, joiners, repeated letters and spaced-out letters). It runs in the browser before sign-in or any request and again in the worker (HTTP 422 `inappropriate`, no quota or model call). Extend the list there only, and add a false-positive check for any new word that is also a substring of common words.
- **One prompt spec.** The system prompt, per-type guidance, output schema and result parsing live in `assets/js/prompt-spec.js`, imported by both `engine.js` and `worker/src/index.js`. Change prompting there only; the worker accepts only `{source, type, lang, detail}` on `/generate` and a WAV recording (≤ `MAX_AUDIO_BYTES`, own daily per-visitor counter) on `/transcribe` with the fixed `TRANSCRIBE_PROMPT`, never a client-supplied prompt, so it cannot be used as a general free LLM.
- **No runtime CDN scripts.** The only third-party runtime code is `assets/vendor/anthropic-sdk.js`, the official SDK bundle, committed to the repo. Rebuild it with `npm run build:vendor`; never hand-edit it.
- **Claude calls go through the official SDK** (`@anthropic-ai/sdk`) in `assets/js/engine.js`, never raw `fetch`.
- **CSP** in `index.html` allows scripts from `'self'` plus Google's GSI client, styles from `'self'` and GSI, fonts from `'self'` only (Vazirmatn is self-hosted in `assets/fonts/`, no Google Fonts, so the UI font also loads where Google is blocked), frames from `accounts.google.com` only, and `connect-src` to `https://*.workers.dev`, `https://api.anthropic.com` and `accounts.google.com` (Google sign-in uses FedCM). Keep it that tight. Do not add inline `<script>`, inline `style="..."` attributes in HTML strings, or `eval`. Set dynamic styles via the CSSOM (`el.style.x = ...`) instead.
- **RTL-first UI** in Persian (`<html lang="fa" dir="rtl">`). Use logical CSS properties (`inset-inline-start`, `margin-inline-end`, `padding-inline-*`). User text fields use `dir="auto"`. English prompt output renders `dir="ltr"`.
- **Escape all user and model content.** Build HTML with `esc()` from `ui.js` or set `textContent`. Search highlighting goes through `highlight()`, which escapes first.
- Keep it lightweight: vanilla ES modules, no new runtime dependencies.

## Layout

```
index.html              App shell, CSP, font and script includes
assets/css/app.css      Design system: tokens (light/dark), layout, components, animations
assets/js/app.js        Hash router + all views (auth, studio, history, archive, profile, settings)
assets/js/engine.js     Engine selection: free service (worker/) or Claude with the user's key; error translation
assets/js/prompt-spec.js Shared system prompt, per-type guidance, JSON schema, option/result normalization, echo detection, formatPrompt (line layout + Persian punctuation)
assets/js/moderation.js  Shared inappropriate-language filter (browser + worker)
assets/js/updates.js    Changelog / "what's new" popup and the Android app's new-version prompt
assets/js/voice.js      Voice: tap-to-record / tap-to-stop input (MediaRecorder → 16 kHz WAV → worker /transcribe → Gemini writes clean text in the spoken language; not the browser's SpeechRecognition, whose Google servers are unreachable from Iran) and read-aloud (speechSynthesis; native TTS plugin in the Android app)
assets/img/             logo.svg (brand mark, brand color #6C4CF5), favicon.svg, icons/ (PNG app icons from tools/render-icons.mjs)
manifest.webmanifest    Installable web app (PWA) manifest
app-android/            Android app: Capacitor shell loading the live site (config, offline page, icon/splash sources, signing key)
.github/workflows/android.yml  Builds the APK and publishes it as the android-latest release
assets/fonts/           Self-hosted Vazirmatn variable font (OFL)
assets/js/prompts.js    Prompt records CRUD, archive, search/filter/sort, facets, backup import/export
assets/js/auth.js       Local accounts (PBKDF2), Google sign-in linking, recovery codes, session, profile/settings, avatar
assets/js/google.js     Google Identity Services loader, button, ID-token parsing
assets/js/config.js     Public site config: GOOGLE_CLIENT_ID, FREE_API_URL (set by the deploy workflow)
worker/                 Cloudflare Worker: POST /generate and POST /transcribe (Gemini), GET /quota, GET /health; Quota Durable Object
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
npm run test:responsive            # 13 viewport sizes x 8 pages x sidebar open/rail: no overflow, tooltips on screen
```

The e2e test covers the guest home, email-first sign-up, the free engine thread (with the worker's real response shape), API key test, generation (and asserts the exact request shape: model, `fallbacks`, beta header, `output_config`), archive save, history search including Arabic/Persian letter folding, archive filters, avatar upload, password change, re-login persistence and the mobile layout. Run it after any change to JS or CSS.

## Conventions

- **Cache-busting:** every local CSS/JS reference carries `?v=<version>` (index.html and all relative `import` specifiers). After changing anything under `assets/`, run `npm run bump` before committing, otherwise returning visitors can get a mix of cached old and new modules. Always write new imports as `'./x.js'`; the bump script adds the version.

- **Everything user-facing is Persian** (brand name «پرامپت‌ساز»), set in the self-hosted Vazirmatn font. UI strings are written inline in the views; there is no i18n layer. Avoid English labels and browser-native English widgets such as `<input type="date">`.
- **Brand:** one color, `--brand: #6C4CF5`, used by the logo (`logoMark()` in `ui.js`, same drawing as `assets/img/logo.svg`), favicon, app icons and accents. After editing the logo, run `node tools/render-icons.mjs` to regenerate every PNG (web and Android).
- **Layout is a chat app:** a sidebar (new prompt, search, archive, recent prompts grouped by day, help and rules, user menu at the bottom; on desktop it collapses to a 60px icon rail with tooltips, under 860px it is an off-canvas drawer), a slim top bar (guest: «ورود» / «ثبت‌نام رایگان»), and a composer-first studio: an empty state with a centered heading, the rounded composer (pill selects for type/language/detail, round send button, Enter sends and Shift+Enter adds a line) and suggestion chips; after sending, a thread with the user's text as a bubble and the result below it (Persian/English tabs, copy, archive, refine). A thread is bookmarkable as `#/studio?p=<id>`.
- **Getting the app:** «دریافت اپ اندروید» in the sidebar and the account menu opens `#/app`; Android browsers also get a dismissible top banner (hidden 30 days, and never shown when `getInstalledRelatedApps()` reports the app installed: `related_applications` in the manifest + `asset_statements` patched into the APK by `android.yml`). None of these show inside the Android app (user agent contains `PromptSazApp`, with `/<versionCode>` from the build). The APK URL lives in `config.js`.
- **Updates (`updates.js`):** `CHANGELOG` (newest first; add an entry with the next `id` for every user-visible release) drives the one-time «تازه‌های این نسخه» popup for returning users and «تازه‌ها» in the account menu/help page. In the app, `checkAppUpdate()` compares the UA version with `assets/android-version.json` (written and committed by `android.yml`) and offers the new APK.
- **Google sign-in in the Android app** is native (Credential Manager via `@capgo/capacitor-social-login`, `window.Capacitor.Plugins.SocialLogin`), because Google blocks its web sign-in inside WebViews. It returns an ID token for the same web client ID, so `parseCredential` and `auth.loginWithGoogle` are shared. It needs an Android OAuth client (package + SHA-1 of `app-android/debug.keystore`) in the same Google Cloud project; APKs without the plugin show no Google button.
- **Pinned prompts:** records carry `pinned`/`pinnedAt` (`prompts.setPinned`, `pinnedOf`). The open sidebar shows «پین‌شده‌ها» above the day groups (pin toggle beside each row, and `#pin-btn` under a result). In the collapsed rail two extra buttons (`.sb-rail-only`, `data-flyout="pinned|recent"`) open a fixed flyout beside the rail, toward the content, with the pinned prompts or the 10 most recent (`openFlyout`, clamped inside the viewport like tooltips).
- **Tooltips** (`enableTooltips` in `ui.js`) are one `position: fixed` element placed by JS and clamped inside the viewport, animating opacity only. Never go back to CSS `::after` tooltips inside the sidebar: near the screen edge they overflowed the page, a scrollbar appeared, hover was lost, and the page flickered. `html, body { overflow-x: clip }` is a second guard (`clip`, not `hidden`, so `position: sticky` keeps working).
- **Responsive:** run `npm run test:responsive` after layout changes.
- **Sign-in** is one dialog (`openAuthModal`) in ChatGPT style: Google button, «یا», then email first → password step (existing account) or name + password (new account), plus a forgot-password step using the recovery code.
- Routes are `#/studio` (public home, `?p=<id>` opens a saved thread), `#/help`, `#/rules` and `#/app` (public; `#/app` is the download page for the Android APK and PWA install), `#/history` (the search page), `#/archive`, `#/profile`, `#/settings` (need sign-in: a guest is kept on the studio, the auth dialog opens, and on success they are sent to the page they asked for). There are no login pages; `openAuthModal()` is the only sign-in UI. Filters are mirrored into the hash query string (bookmarkable) via `syncQuery()` without re-routing.
- Every generation is stored immediately as a prompt record with `archived: false`. Archiving sets `archived: true` plus metadata. Deleting from history deletes the record everywhere.
- The default engine is the free service (`settings.engine = 'free'`); it needs `FREE_API_URL` in `config.js`. The worker uses `GEMINI_MODEL` (default alias `gemini-flash-latest`) with `GEMINI_FALLBACK_MODEL` when busy; both are vars in `worker/wrangler.toml`.
- In Claude mode the default model is `claude-opus-5` with `output_config.effort: "medium"`, structured JSON output (`output_config.format` with a JSON schema), and server-side refusal fallbacks (`fallbacks: "default"` + beta `server-side-fallback-2026-07-01`) on Opus. Streaming is used with `finalMessage()` to avoid HTTP timeouts. See `docs/PROMPT_ENGINE.md` before changing any of this.
- The IndexedDB schema version is `DB_VERSION` in `db.js`. Add migrations in `onupgradeneeded`; never drop user data.

## Deployment

Primary: Cloudflare Pages at `https://promptsaz.pages.dev`, published by `.github/workflows/deploy-pages.yml` (copies `index.html`, `assets/`, `manifest.webmanifest`, `privacy.html`, `terms.html`; add any new root-level site file there). Also GitHub Pages, "Deploy from a branch", root folder (`.nojekyll` must stay at the root). Both origins must be in the worker's `ALLOWED_ORIGINS` and in the Google OAuth client. The Android app loads `server.url` in `app-android/capacitor.config.json` (the GitHub Pages address, because `pages.dev` is unreachable from some networks in Iran). See `docs/DEPLOYMENT.md`.
