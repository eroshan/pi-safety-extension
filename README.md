# Pi Safety Extension

A small, fail-closed gate for LLM-initiated `bash` tool calls.

## Flow

```text
bash request -> local safety floor -> model security review -> combined result
```

A conservative local policy sets the minimum decision before the configured review model runs. Catastrophic commands are blocked locally, simple read-only commands (`pwd`, `whoami`, `ls`, `id`, `uname`, and restricted `git status`) may be auto-approved after model review, and every other command requires at least confirmation. The model can only increase risk or move the action from `allow` to `confirm` or `block`; it can never lower the local decision. There is no cache, retry, user override for blocked decisions, or allow-on-error path.

The command and working directory are JSON-encoded and sent to the model as explicitly untrusted data. Model review requests have a 30-second deadline and follow Pi's abort signal.

The model must return exactly:

```json
{
  "risk": "low",
  "reason": "read-only command",
  "recommendedAction": "allow"
}
```

Assessments that require approval are shown in a colored, indented dialog with risk, reason, and command. Use `j`/`k` (or the arrow keys) to move between Allow and Decline, then press Enter to select. Run `/safety-review-debug-toggle` to additionally show the review model and request time. The model's action is intentionally hidden from the dialog. Policy is fail-closed:

- a locally allowlisted command runs immediately only when the combined result is `low` risk with action `allow`, and adds a small blue `safety-review: auto-approved` transcript header;
- `medium` or `high` risk requires explicit user confirmation in a colored, indented dialog;
- a local or model `block` action is always declined;
- declining a confirmation aborts the current agent operation, stops sibling tool execution, and waits for the next user input;
- while a confirmation is open, the extension emits `agent:blocked` and `herdr:blocked` events with `{ active, label, source }`;
- action `confirm` also opens the dialog;
- `critical` risk is always declined;
- no UI when confirmation is required is declined;
- missing/unavailable models, authentication failures, model errors, and invalid output are declined; a missing review response is reported as `Review model returned no response`.

## Installation

Requires Pi 0.84.2 or newer.

```text
pi install ssh://git@github.com/eroshan/pi-safety-extension
```

Run `/safety-setup` in an interactive Pi session to select the review model. The selection takes effect after it is saved atomically in `$PI_CODING_AGENT_DIR/safety-extension/config.json` (or `~/.pi/agent/safety-extension/config.json` by default). On upgrade, the extension migrates a package-local selection when the old file is still available; otherwise run `/safety-setup` once to recreate it.

Run `/safety-review-selftest [command]` to send a real test request to that model (`pwd` is used by default). The UI shows the request, model name, start time, elapsed request time, and parsed model output. The self-test reviews the command but does not execute it.

Run `/security-review-prod-toggle` to toggle production mode for the current session. While enabled, every bash command requires explicit user confirmation and commands are never sent to the AI review model. Missing UI, confirmation errors, and declined prompts block execution.

Only LLM-initiated `bash` tool calls are gated. User `!` / `!!` shell commands are outside this extension's scope.

## Development

```text
npm install
npm test
npm run lint
```
