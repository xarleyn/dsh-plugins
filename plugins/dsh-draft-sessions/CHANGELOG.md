# Changelog

All notable changes will be documented here. The project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Added draft rows through the composable Harness sidebar slot without replacing or embedding the active workspace browser.
- Excluded backing blank Sessions only from the workspace-browser standard hooks, preserving Archive Manager and ordinary browser behavior.
- Added a visible Drafts `+` action that flushes the current draft before creating and opening a distinct one.
- Portaled draft row menus above sidebar panels so opening a menu cannot expand or clip inside the draft scroller.
- Activated draft controllers from a context explicitly injected with the dynamically mounted `remote.draftSessions` service.
- Restored the production `Ctrl/Cmd + Shift + N` listener when controller dependencies are supplied explicitly.
- Memoized draft-filtered Session and Workspace selector snapshots to prevent React external-store update loops.
- Versioned Host-backed DraftStore with atomic JSON persistence.
- CRUD, ordering, per-Workspace limits, recovery rebinding, and optimistic revisions.
- Strict Typert Remote contribution for the Web client.
- Client lifecycle bridge for distinct blank Session creation and missing-shell recovery.
- Accepted-prompt observation and blank-to-materialized DraftRecord finalization.
- Official InputHub restore and serialized debounced optimistic autosave.
- Current/recent-Workspace `Ctrl/Cmd + Shift + N` draft creation.
- Draft-first sidebar projection with backing-shell deduplication and optimistic reorder plans.
- Initial tests, architecture documentation, specification, roadmap, and CI.
