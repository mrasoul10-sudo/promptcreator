# Prompt engine

`assets/js/engine.js` turns a rough idea into a professional prompt with one of two engines:

- **Free (default):** posts `{source, type, lang, detail}` to the worker (`FREE_API_URL`), which builds the same prompt from `assets/js/prompt-spec.js` and calls Gemini (`generateContent` with `responseMimeType: application/json` and a `responseSchema` converted from the shared JSON schema: upper-case types, no `additionalProperties`). Thinking parts are ignored; a Markdown code fence around the JSON is tolerated. See `docs/ARCHITECTURE.md` for quotas and fallbacks.
- **Claude with the user's own key:** described below.

The system prompt, type guidance, detail levels, schema and result parsing are shared by both (`prompt-spec.js`), so output quality rules live in one place.

## Claude request

| Setting | Value | Why |
|---|---|---|
| SDK | `@anthropic-ai/sdk` (bundled) | Official client: typed errors, retries (`maxRetries: 2`), streaming helpers |
| Model | `claude-opus-5` by default; `claude-sonnet-5` and `claude-haiku-4-5` selectable | Best rewrite quality by default; users can choose faster or cheaper models |
| Effort | `output_config.effort`, default `medium` (Opus and Sonnet only) | Rewriting does not need maximum reasoning, and medium keeps latency reasonable. Users can raise it. |
| Output | `output_config.format` = JSON schema | Guarantees parseable `{title, detected_language, prompt_en, prompt_fa, notes}` |
| Transport | `messages.stream(...).finalMessage()` | Avoids HTTP timeouts on long outputs without handling individual events |
| `max_tokens` | 16000 | Leaves room for adaptive thinking plus two full prompts |
| Refusal fallbacks | `fallbacks: "default"` + beta `server-side-fallback-2026-07-01`, via `client.beta.messages.stream` (Opus only) | If a safety classifier declines, the server retries on the recommended fallback model |

Thinking is left at the model default (adaptive on Opus 5). Thinking blocks are ignored and only `text` blocks are parsed.

## Prompting

The system prompt is static, so it is cache-friendly. It defines the role (expert bilingual prompt engineer who writes prompts and does not answer them) and the rules:

- preserve intent exactly, and put `[placeholders]` where information is missing instead of inventing facts;
- use the structure models respond to: role, task, context, requirements and constraints, steps, output format;
- write native-quality English and natural Persian, keeping technical terms, product names and code in English;
- keep both language versions equivalent, and return `""` for a language that was not requested.

The user message carries the per-request variables: prompt type (with type-specific guidance for general, coding, image, video, writing, research, marketing and agent/system prompt), detail level (concise ~80–180 words, balanced ~180–400, detailed ~400–900), and the output languages. The user's text is wrapped in `<input>` tags.

## Response handling

1. `stop_reason === "refusal"`: show a Persian message asking the user to rephrase.
2. `stop_reason === "max_tokens"`: ask the user to lower the detail level.
3. Parse JSON from the text blocks. On failure, show a retry message.
4. Blank out any language the user did not request, as a guard against the model filling it anyway.

## Errors

SDK error classes are mapped to Persian messages: `AuthenticationError` (bad key), `PermissionDeniedError`, `NotFoundError` (model), `RateLimitError`, `BadRequestError` (including a specific message when the credit balance is too low), `InternalServerError`, `APIConnectionError` (network or VPN), and `APIUserAbortError` (user pressed Stop).

## Changing the engine

- Keep the request going through the SDK, not `fetch`.
- If you change the JSON schema, update the parsing in `generate()` and the record fields in `prompts.create()`.
- Run `npm run test:e2e`. It asserts the request shape (model, fallbacks, beta header, output_config, streaming, browser-access header).
