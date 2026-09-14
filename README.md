# Pi Safety Extension

A small, fail-closed gate for LLM-initiated `bash` tool calls.

## Flow

```text
bash request -> model security review -> review result
```

Every bash request is sent to the configured review model as-is. There is no command parsing, whitelist, normalization, cache, retry, user override, or allow-on-error path.

The model must return exactly:

```json
{
  "risk": "low",
  "reason": "read-only command",
  "recommendedAction": "allow"
}
```

Assessments that require approval are shown in a colored, indented dialog with risk, reason, and command. Run `/safety-review-debug-toggle` to additionally show the review model and request time. The model's action is intentionally hidden from the dialog. Policy is fail-closed:

- `low` risk with action `allow` runs immediately and adds a small blue `safety-review: auto-approved` transcript header;
- `medium` or `high` risk requires explicit user confirmation in a colored, indented dialog, even when the model recommends `block`;
- action `confirm` also opens the dialog;
- `critical` risk is always declined;
- a `low`-risk `block` action is declined;
- no UI when confirmation is required is declined;
- missing/unavailable models, authentication failures, model errors, and invalid output are declined.

## Installation

```text
pi install ssh://git@github.com/eroshan/pi-safety-extension
```

Run `/safety-setup` in an interactive Pi session to select the review model. The selection takes effect immediately and is stored in `state/config.json`.

Run `/safety-review-selftest [command]` to send a real test request to that model (`pwd` is used by default). The UI shows the request, model name, start time, elapsed request time, and parsed model output. The self-test reviews the command but does not execute it.

Run `/security-review-prod-toggle` to toggle production mode for the current session. While enabled, every bash command requires explicit user confirmation and commands are never sent to the AI review model. Missing UI, confirmation errors, and declined prompts block execution.

Only LLM-initiated `bash` tool calls are gated. User `!` / `!!` shell commands are outside this extension's scope.

## Development

```text
npm install
npm test
npm run lint
```
