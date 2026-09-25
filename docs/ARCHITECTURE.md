# Architecture

## Overview

Prompt Creator is a single-page application made of plain ES modules, served as static files from GitHub Pages. There is no server: the browser stores all data in IndexedDB and talks directly to the Claude API with the user's own API key.

```
┌──────────────────────── Browser ─────────────────────────┐
│  index.html ── app.js (router + views)                   │
│                 │        │          │          │         │
│              auth.js  prompts.js  engine.js   ui.js      │
│                 └────┬───┘          │                    │
│                    db.js            │ @anthropic-ai/sdk  │
│                 (IndexedDB)         │ (vendor bundle)    │
└─────────────────────────────────────┼────────────────────┘
                                      ▼
                           https://api.anthropic.com
```

## Modules

| Module | Responsibility |
|---|---|
| `app.js` | Hash router, app chrome (sidebar and mobile bottom nav), theme, and all page views. Views render HTML strings built with `esc()`, then attach listeners. |
| `engine.js` | Builds the Claude request (system prompt, per-type guidance, JSON schema), sends it with the SDK, validates the stop reason, parses JSON, and maps SDK errors to Persian messages. |
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

- **Scope:** accounts are local to one browser profile. The password protects a profile from casual use on a shared browser; it is not a server-side account. Anyone with access to the device's browser storage can read the data, including the API key.
- **API key:** stored in IndexedDB and sent only to `api.anthropic.com` (enforced by CSP `connect-src`). The SDK is created with `dangerouslyAllowBrowser: true`, which is the intended mode for a bring-your-own-key client app.
- **XSS:** CSP allows only same-origin scripts, no inline scripts or `eval`. All user and model content is escaped or set via `textContent`.
- **Uploads:** avatars are decoded by the browser and re-encoded through a canvas, which discards any embedded payload and caps the size.
- **Imports:** backup files are validated and every field is coerced to its expected type. IDs that belong to another local account are regenerated.

## Sign-in

- **Email and password.** On sign-up the user gets a 12-character recovery code, shown once, with copy and download buttons. Only its PBKDF2 hash is stored. "Forgot password" takes the email, the code and a new password, then signs the user in and issues a new code (codes are single-use).
- **Google.** Google Identity Services returns an ID token to the page. Without a backend its signature cannot be verified, so it is used only to identify the user for their local account: it is matched or linked by verified email, or a password-less account is created. A session opened with Google may set a new password without the old one, which is the recovery path for Google users.
- **Persistence.** With "remember me" the session id is kept in `localStorage` and survives closing the browser and restarting the computer. Prompts are always saved in IndexedDB. Clearing site data or using a private window loses both, so export a backup.

## Why no backend

The requirement was a URL that works in any browser, hosted from this GitHub repository. GitHub Pages serves static files only, so the design keeps everything client-side. Moving to real server accounts later would mean replacing `db.js` and `auth.js` with API calls. The views and engine would not need to change.
