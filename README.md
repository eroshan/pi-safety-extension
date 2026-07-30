# Safety Extension Design (Pi)

This repository implements a **Pi extension** (not a built-in tool) that gates **LLM-initiated** bash tool calls.

> Important constraint: all runtime state lives **inside the extension folder** (under `state/`).

## Scope / Non-goals

- Intercepts **only** `tool_call` events where `toolName === "bash"`.
- Does **not** intercept user shell commands (`!` / `!!`). No `user_bash` hook is registered.
- No agent allowlist/excludelist is implemented.
- No persistent “background review session” is implemented; each review is a **stateless** model call (with caching).

## State layout (inside extension folder)

The extension resolves its root directory via `import.meta.url` and uses:

```
state/
  config.json
  logs/
    bash-audit.log
    cache-mirror.log
    debug.log
  cache.sqlite3          (only if sqlite backend is enabled and dependency installed)
```

All configured paths are resolved to remain within the extension directory.

## Configuration (environment variables)

All options listed below can also be set in `state/config.json` using the same field names/structure (see example further down). If an environment variable is set, it **takes priority** over `state/config.json`.

### Core

- `SAFETY_ENABLED` (default: `true`) — master on/off.
- `SAFETY_ALLOW_WITHOUT_UI` (default: `false`) — if confirmation is required but `ctx.hasUI === false`.
- `SAFETY_ALLOW_ON_REVIEW_FAILURE` (default: `false`) — allow if model review fails.
- `SAFETY_BLOCK_CRITICAL_COMMANDS` (default: `true`) — block commands with `risk=critical`.

### Auto-allow whitelist

- `SAFETY_AUTO_ALLOW_WHITELIST` (default: `true`) — allow a conservative set of read-only commands *only when no advanced shell syntax is present*.

Current whitelist (conservative):
- `pwd`, `whoami`, `date`, `echo`
- `ls`, `cat`, `head`, `tail`
- `rg`, `grep`
- `find` (blocked when `-exec`, `-execdir`, `-delete`, or `-ok` is present)
- `git status`, `git diff`, `git branch`, `git show-ref`, `git remote`, `git rev-parse --show-toplevel` / `--is-inside-work-tree`, `git log -n <number>`
- `go test`, `go build`, `go vet`, `go env`, `go version`, `gofmt -d`, `gofmt -l`
- `npm test`, `npm run lint|typecheck|type-check|check|test|build`
- `npx tsc --noEmit` (requires `--noEmit` flag)

### Cache

- `SAFETY_CACHE_ENABLED` (default: `true`)
- `SAFETY_CACHE_BACKEND` (default: `memory`) — set to `sqlite` to enable SQLite cache.
- `SAFETY_CACHE_MAX_ENTRIES` (default: `2000`)
- `SAFETY_SQLITE_CACHE_PATH` (default: `state/cache.sqlite3`) — path relative to the extension root.

SQLite backend uses `better-sqlite3` **if installed**. If the dependency is missing or DB open fails, it **falls back to memory** and (optionally) debug-logs the reason.

### Logging

- `SAFETY_BASH_AUDIT_ENABLED` (default: `true`) → `state/logs/bash-audit.log`
- `SAFETY_CACHE_MIRROR_ENABLED` (default: `false`) → `state/logs/cache-mirror.log`
- `SAFETY_DEBUG_ENABLED` (default: `false`) → `state/logs/debug.log`

### UX (optional)

- `SAFETY_SHOW_AUTOAPPROVED_VERDICT` (default: `false`) — if `true` and UI is available, shows a terminal notification when a command is auto-approved (whitelist/cache/review).
- `SAFETY_PROGRESS_FINAL_HOLD_MS` (default: `2000`) — minimum time (ms) the safety review progress indicator stays in its final (decision) state before resetting back to idle. If a new bash request starts, the indicator resets immediately.
- When the extension is about to ask the user for approval via `ctx.ui.confirm(...)`, it emits the inter-extension event `notify:alert` with `{ title, message }`. This lets a separate notify extension surface desktop notifications. If no extension listens for that event, nothing extra happens.
- While the approval dialog is open, the extension also emits `herdr:blocked` with `{ active: true, label }`, and clears it with `{ active: false }` when the dialog closes.

## Review model selection (first run)

### Requirements

- The extension uses a configurable *cheaper* model for safety review.
- The selection is persisted to `state/config.json`:

```json
{
  "reviewModel": { "provider": "...", "id": "..." },

  // Any of the env-configurable options can also be set here.
  "enabled": true,
  "cache": { "backend": "sqlite", "maxEntries": 2000 }
}
```

### When the UI prompt is shown

To avoid startup/UI edge-cases, the extension **does not open dialogs during `session_start`**.

Instead:
- On the **first user turn** (`before_agent_start`, UI only), if no `reviewModel` is configured, it prompts via `ctx.ui.select(...)`.
- A manual command is available: `/safety-setup` to (re)select the review model.
- In non-UI modes, if the model is not configured, bash tool execution is **blocked** with an instruction to run interactive setup.

## Command analysis & normalization

### Advanced shell syntax detection

The raw command string is scanned conservatively for operators/features that increase risk:
- pipes `|`
- boolean chaining `&&`, `||`
- separators `;` or newline
- redirections `>`, `>>`, `<`, `<<`
- command substitution `$()` and backticks
- grouping/subshell `{}` and `()`

If advanced syntax is detected:
- whitelist auto-allow is disabled
- the command must go through the model review path (or cache).

### Normalization

Normalization is used for sanitization and stable caching:
- Extracts leading `cd <dir>` (optionally followed by `&&` or `;`) to compute an **effective CWD**.
- Tokenizes while preserving quoted segments.
- Replaces path-like tokens with `<pathN>`, URLs with `<urlN>`.
- Generalizes long hex strings to `<hex>` and numbers to `<number>`.
- Sorts “simple flags” runs for stability.
- Computes keys:
  - `baseKey = sha256("<cwd>||<stableCommand>")[0..16]`
  - `fingerprintKey = "<baseKey>-<pathFingerprint>"` where the fingerprint incorporates extracted paths/URLs.

## Safety review execution

### Model call

Safety reviews are performed via `@earendil-works/pi-ai/compat`:
- `completeSimple(model, context, { apiKey, headers, reasoning: "off" })`

Request auth is resolved through `ctx.modelRegistry.getApiKeyAndHeaders(model)`, which may return:
- an `apiKey`
- request `headers`
- or both

The safety review rejects the request if auth resolution fails, or if neither an API key nor headers are available for the selected model.

### Verdict schema

The review model must return a **single JSON object** (no markdown) of the form:

```json
{
  "risk": "low" | "medium" | "high" | "critical",
  "reason": "...",
  "dependsOnPaths": true | false,
  "recommendedAction": "allow" | "confirm" | "block"
}
```

Validation is **strict**:
- No extra keys beyond `risk`, `reason`, `dependsOnPaths`, `recommendedAction`
- `reason` must be non-empty and <= 500 characters

If parsing/validation fails, the extension retries the model up to **2 times** with a repair prompt that includes the validation error.

A dedicated auth-resolution unit test covers both the successful `apiKey + headers` path and the failure path when no auth is configured.

### Caching rules

- If `dependsOnPaths=false`, store under `baseKey`.
- If `dependsOnPaths=true`, store under `fingerprintKey` to avoid reusing a verdict across different targets.

The extension also deduplicates concurrent reviews in-process (one in-flight review per command fingerprint).

## Policy application

After a verdict (from cache or review):

- If `risk=critical` and `SAFETY_BLOCK_CRITICAL_COMMANDS=true` → block.
- If `recommendedAction=block` → block.
- If `recommendedAction=confirm` or `risk in {medium, high, critical}` → require confirmation:
  - UI mode: emit `notify:alert` (`{ title, message }`), emit `herdr:blocked` while waiting for input, then call `ctx.ui.confirm(...)`
  - non-UI mode: allow only if `SAFETY_ALLOW_WITHOUT_UI=true`, otherwise block.
- Otherwise → allow.

All decisions are logged to `bash-audit.log` when audit logging is enabled.
