# Safety Extension — Testing Strategy

Tests focus on the fail-closed request flow and run without network access.

## Covered behavior

- A low-risk bash request runs only after a review recommends `allow` and adds an auto-approved transcript marker.
- Approval dialogs show risk, reason, and command without a separate notification or action field.
- Model and request timing details are hidden unless debug display is toggled on.
- Medium and high risks use a colored, indented confirmation dialog, including when the model recommends `block`.
- Critical risks are always declined.
- Missing UI or declined confirmation blocks execution.
- Missing or unavailable models decline the request.
- Model discovery, authentication, provider, and parsing failures decline the request.
- Review output uses the prompt's strict three-field schema and rejects extra fields.
- The raw command is placed in the prompt as untrusted data without parsing or normalization.
- Model selection state accepts and stores only a provider/id reference.
- A newly selected model is used immediately by bash reviews and self-tests.
- Self-tests make a real mocked review call and report the model, request, timing, and output.

`completeSimple` and the model registry are mocked. Tests never execute bash requests or call a real model.

## Run

```text
npm install
npm test
npm run lint
```
