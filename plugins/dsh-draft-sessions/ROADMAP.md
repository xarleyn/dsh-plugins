# Roadmap

## Milestone 1 — durable core

- [x] Versioned `DraftSession` schema
- [x] Host-backed JSON persistence
- [x] Serialized atomic writes
- [x] CRUD, ordering, limits, and optimistic revisions
- [x] Strict Typert Remote Client contribution
- [x] Unit tests and package build

## Milestone 2 — blank Session lifecycle

- [x] Create a distinct Session with `sessions.create({ workspaceId })`
- [x] Persist `sessionId` only after successful creation
- [x] Detect missing Session shells and rebind replacements
- [x] Observe `blank: true → false` and finalize only after accepted Send
- [x] Preserve drafts after rejected Send

## Milestone 3 — composer bridge

- [x] Restore text through the official InputHub/input actions
- [x] Debounced optimistic autosave
- [x] Flush pending autosave before switching Sessions
- [x] Surface remote revision conflicts
- [x] Add `Ctrl/Cmd + Shift + N`

## Milestone 4 — sidebar integration

- [x] Use the cooperative Drafts tab when available and the stock sidebar
  footer popover otherwise. This supersedes the original plan for inline rows
  above ordinary Sessions. The [sidebar design](./README.md) explains the Host API limits.
- [x] Muted state, context menu, keyboard navigation, and drag reorder
- [x] Preserve the active workspace browser and ordinary Session behavior
- [x] Compose with Archive Manager independently of activation order

## Milestone 5 — compatibility and release

- [x] Ship through the monorepo's [version-plan release workflow](../../.github/workflows/release.yml).
- [x] Browser reload E2E
- [x] Host restart/rebind E2E
- [x] Accepted/rejected Send E2E
- [ ] Collect packed browser smoke results from Windows, macOS and Linux for
  the same revision. The [current CI](../../.github/workflows/ci.yml) runs on Ubuntu.
- [x] Packed-install smoke test
- [x] Compatibility matrix across supported DSH releases
- [x] [Version 0.2.0 was published to npm](https://www.npmjs.com/package/@yadsh/dsh-draft-sessions/v/0.2.0).
