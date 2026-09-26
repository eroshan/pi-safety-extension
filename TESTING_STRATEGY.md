# Safety Extension — Testing Strategy

Tests focus on the fail-closed request flow and run without network access.

## Covered behavior

- A locally allowlisted, low-risk bash request runs only after a review recommends `allow` and adds an auto-approved transcript marker.
- Catastrophic commands are blocked locally, and unknown or shell-composed commands require at least confirmation.
- The model can raise but never lower the local risk and action floor.
- Approval dialogs show risk, reason, and command without a separate notification or action field.
- Model and request timing details are hidden unless debug display is toggled on.
- Medium and high risks use a colored, indented confirmation dialog unless the model recommends `block`, which is always declined.
- Critical risks are always declined.
- Missing UI or declined confirmation blocks execution, and a user decline aborts the current agent operation.
- Missing or unavailable models decline the request.
- Model discovery, authentication, provider, timeout, cancellation, and parsing failures decline the request.
- Model requests use Pi's registry completion path so authless, custom, and provider-scoped configurations remain supported.
- Review output uses the prompt's strict three-field schema and rejects extra fields.
- The raw command and working directory are JSON-encoded in the prompt as explicitly untrusted data.
- Model selection state accepts and atomically stores only a provider/id reference outside the package checkout.
- A newly selected model is used immediately by bash reviews and self-tests.
- Self-tests make a real mocked review call and report the model, request, timing, and output.
- Production mode confirms every bash command without invoking the AI reviewer and fails closed without UI.

`completeSimple` and the model registry are mocked. Tests never execute bash requests or call a real model.

## Run

```text
npm install
npm test
npm run lint
```
