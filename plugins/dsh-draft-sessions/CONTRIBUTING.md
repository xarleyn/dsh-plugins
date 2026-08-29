# Contributing

Thank you for helping make draft Sessions reliable.

## Before opening a change

1. Keep the change focused on one lifecycle or UI concern.
2. Add or update tests for observable behavior.
3. Preserve ordinary DeepSeek Harness Session behavior.
4. Run the full local gate:

```bash
pnpm install
pnpm check
```

## Pull requests

Describe the user-visible outcome, the recovery behavior, and any DSH package/version assumption. UI changes should include a screenshot or short recording. Changes touching Session materialization should cover both accepted and rejected prompt paths.

## Design principles

- Never send model input before an explicit Send.
- Never treat a button click as proof the Host accepted a prompt.
- Never store draft order in ordinary Workspace Session ordering.
- Never silently reset corrupt durable data.
- Prefer public DSH contracts and additive slots; do not replace a foreign single-slot occupant.

By participating, you agree to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
