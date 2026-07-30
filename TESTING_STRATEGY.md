# Safety Extension — Testing Strategy

## Goals

1. Cover the core decision pipeline logic with **unit tests** for deterministic parts:
   - command analysis (advanced syntax detection)
   - tokenization
   - normalization + cache-key generation
   - whitelist auto-allow
   - caching backends (memory + SQLite fallback)
   - state-path constraints (everything inside extension folder)
   - verdict schema validation + internal concurrency dedupe
   - approval-notification event formatting / emission (`notify:alert`)
   - blocked-state event emission (`herdr:blocked`)

2. Keep tests **offline** (no real model calls). LLM review itself is treated as an integration concern.

## Test Types

### 1) Pure unit tests (fast, deterministic)
Covers:
- `src/analyze/*`
- `src/cache/*` (excluding real SQLite dependency)
- `src/state.ts`
- `src/review/verdict.ts`, `src/review/dedupe.ts`
- `src/review/safety-review.ts` auth resolution behavior
- `src/ui/approval-event.ts`

### 2) Lightweight integration tests (optional, future)
If desired later:
- Stub `ctx.modelRegistry.getApiKeyAndHeaders()` and stub `completeSimple()` to return canned JSON.
- Cover auth combinations: API-key-only, headers-only, API-key-plus-headers, and auth lookup failures.
- Exercise the `tool_call` handler end-to-end (requires importing `index.ts` and mocking `@earendil-works/pi-coding-agent`).

### 3) Manual QA checklist (optional, future)
- First-run UI model selection persists `state/config.json`.
- Confirm prompts appear only for `medium/high/critical`.
- When confirmation is required, the extension emits `notify:alert` so a separate notify extension can surface a desktop notification.
- While waiting for approval, the extension emits `herdr:blocked` and clears it when the dialog closes.
- Cache hits prevent repeated confirmations.
- Logs are written under `state/logs/`.

## What we explicitly do NOT test (unit level)
- Real model/provider availability
- Real UI dialogs
- Real bash execution (the extension only gates; pi executes)

## How to run

```bash
npm i
npm test
```

If you want to validate the optional SQLite backend, install `better-sqlite3` and run tests again.
