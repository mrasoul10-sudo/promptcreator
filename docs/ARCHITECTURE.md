# Architecture

## Overview

Prompt Creator is a single-page application made of plain ES modules, served as static files (Cloudflare Pages and GitHub Pages). Accounts and prompts live on the account server (`worker/src/store.js`, a SQLite Durable Object in the same Cloudflare Worker); the browser keeps a cache in IndexedDB and `sync.js` keeps both in step, so the website, the Android app and every device show the same prompts. Prompts are generated either by the site's free service (a stateless Cloudflare Worker that calls Gemini with the site owner's key) or, if the user chooses, by Claude directly with the user's own key.

```
┌──────────────────────── Browser ─────────────────────────┐
│  index.html ── app.js (router + views)                   │
│                 │        │          │          │         │
│              auth.js  prompts.js  engine.js   ui.js      │
│                 └────┬───┘     │         │               │
│                    db.js       │ free    │ own key       │
│                 (IndexedDB)    │         │ (SDK bundle)  │
└────────────────────────────────┼─────────┼───────────────┘
                                 ▼         ▼
             worker/ (Cloudflare)         https://api.anthropic.com
       quota Durable Object + GEMINI_API_KEY
                                 ▼
          generativelanguage.googleapis.com (Gemini)
```

## Free service (`worker/`)

- `POST /generate` accepts only `{source, type, lang, detail}`. The prompt itself is built server-side from `assets/js/prompt-spec.js` (shared with the browser), so the endpoint cannot be used as a general-purpose free LLM.
- CORS is limited to `ALLOWED_ORIGINS`; requests with any other `Origin` are refused.
- Quotas in a single SQLite-backed Durable Object: per visitor per UTC day (`DAILY_LIMIT_PER_VISITOR`), whole site per day (`DAILY_LIMIT_GLOBAL`, kept under Gemini's free daily cap) and per minute (`PER_MINUTE_LIMIT_GLOBAL`). Visitors are identified by a salted SHA-256 of their IP; raw IPs are never stored. A failed upstream call refunds the quota.
- Gemini is called with `responseMimeType: application/json` and a `responseSchema` derived from the shared schema. If the primary model (`GEMINI_MODEL`, default `gemini-flash-latest`) is busy or missing, `GEMINI_FALLBACK_MODEL` is tried.
- Nothing the user writes is stored by the worker.
- `.github/workflows/deploy-worker.yml` runs the worker test, deploys with wrangler, and commits the resulting URL into `assets/js/config.js` (`FREE_API_URL`).

## Modules

| Module | Responsibility |
|---|---|
| `app.js` | Hash router, app chrome (sidebar and mobile bottom nav), theme, and all page views. Views render HTML strings built with `esc()`, then attach listeners. |
| `engine.js` | Chooses the engine from the user's settings. Free: posts to the worker and reports the remaining daily quota. Claude: builds the request from `prompt-spec.js`, sends it with the SDK, validates the stop reason, parses JSON, and maps SDK errors to Persian messages. |
| `prompt-spec.js` | Shared by browser and worker: system prompt, per-type guidance, detail levels, JSON schema, option normalization and result parsing. |
| `prompts.js` | Prompt record CRUD with ownership checks, archive and unarchive, clear history, search (term AND-matching over folded text), filters, sorting, facets (category and tag counts), and backup export/import. |
| `auth.js` | Local accounts: register, login, logout, session restore ("remember me" → `localStorage`, otherwise `sessionStorage`), profile and settings updates, password change (PBKDF2-SHA256, 210k iterations, random salt), one-time recovery codes and password reset, Google sign-in linking, avatar processing (center crop, 256px re-encode to WebP/PNG), account deletion. |
| `google.js` | Loads Google Identity Services on demand, renders the button (popup mode), decodes the ID token and checks `aud`, `iss`, `exp` and `email_verified`. |
| `db.js` | Minimal promise wrapper over IndexedDB. |
| `ui.js` | Escaping, SVG icons, toasts, accessible modal, confirm dialog, clipboard, Jalali date formatting, highlight, downloads. |

## Data model (IndexedDB `promptcreator`, version 1)

### `users` (keyPath `id`, unique index `email`)

| Field | Type | Notes |
|---|---|---|
| `id` | string | UUID |
| `name`, `email` | string | Email is lowercased and unique per browser |
| `salt`, `passHash` | string \| null | Hex; PBKDF2-SHA256. `null` for Google-only accounts |
| `recoverySalt`, `recoveryHash` | string | Hash of the one-time recovery code (the code itself is never stored) |
| `googleSub` | string | Google account id, when linked |
| `avatar` | string \| null | Data URL (256×256 WebP/PNG) |
| `color` | string | Fallback avatar color |
| `settings` | object | `apiKey`, `model`, `effort`, `defaultType`, `defaultLang`, `defaultDetail` |
| `createdAt`, `updatedAt` | number | ms epoch |

### `prompts` (keyPath `id`, index `userId`)

| Field | Type | Notes |
|---|---|---|
| `id`, `userId` | string | |
| `source` | string | The user's original text |
| `title` | string | Generated, editable |
| `promptEn`, `promptFa` | string | Empty when that language was not requested |
| `improvements` | string[] | Model's short notes on what it improved |
| `type`, `lang`, `detail` | string | Generation options |
| `model`, `usage` | string, object | Model that answered; input/output tokens |
| `notes`, `category`, `tags` | string, string, string[] | Archive metadata |
| `favorite`, `archived` | boolean | |
| `archivedAt`, `createdAt`, `updatedAt` | number \| null | |

History is every record. The archive is `archived === true`.

## Search

`prompts.fold()` normalizes text before matching: lowercase; Arabic `ي ى ك ة ؤ أ إ آ` folded to Persian forms; harakat removed; ZWNJ turned into a space; Persian and Arabic digits turned into ASCII. The query is split on whitespace and every term must appear somewhere in title, source, both prompts, notes, category or tags. Filters (category, tag, type, language, favorites, date range) and sort (newest, oldest, last edited, title) are applied in memory. This comfortably handles thousands of records.

## Security model

- **Accounts:** server-side. The password is stretched in the browser (PBKDF2-SHA256, 210k iterations, per-account random salt) and only that key is sent; the server stores SHA-256(server salt + key), limits failed attempts (10 per hour per email) and issues random bearer tokens (hashed at rest). Google ID tokens are verified server-side against Google's keys. A first Google sign-in on an existing password account removes the unverified password and its sessions. The admin is `ADMIN_EMAIL` with a linked Google account; the admin API never returns prompt text.
- **Sync:** prompt records are opaque JSON per user; last write wins by `updatedAt`, deletions are tombstones, and clients pull by a per-user sequence cursor. Settings and the Claude API key are never uploaded.
- **API key:** stored in IndexedDB and sent only to `api.anthropic.com` (enforced by CSP `connect-src`). The SDK is created with `dangerouslyAllowBrowser: true`, which is the intended mode for a bring-your-own-key client app.
- **XSS:** CSP allows only same-origin scripts, no inline scripts or `eval`. All user and model content is escaped or set via `textContent`.
- **Uploads:** avatars are decoded by the browser and re-encoded through a canvas, which discards any embedded payload and caps the size.
- **Imports:** backup files are validated and every field is coerced to its expected type. IDs that belong to another local account are regenerated.

## Sign-in

- **Email and password.** On sign-up the user gets a 12-character recovery code, shown once, with copy and download buttons. Only its PBKDF2 hash is stored. "Forgot password" takes the email, the code and a new password, then signs the user in and issues a new code (codes are single-use).
- **Google.** Google Identity Services returns an ID token to the page. Without a backend its signature cannot be verified, so it is used only to identify the user for their local account: it is matched or linked by verified email, or a password-less account is created. A session opened with Google may set a new password without the old one, which is the recovery path for Google users.
- **Persistence.** With "remember me" the session token is kept in `localStorage` (180-day session) and survives closing the browser; otherwise in `sessionStorage`. Prompts are saved locally first and uploaded by `sync.js`; clearing site data only removes the local copy.

## Why (almost) no backend

The requirement was a URL that works in any browser, hosted from this GitHub repository. The site stays static; the only server is the Cloudflare Worker, which hosts both the free prompt service (an API key can never be shipped to browsers) and, since the move to synced accounts, the account/sync server. `auth.js` kept its interface when it moved from local accounts to the server, so the views did not need to change.
