# dsh-draft-sessions

[![CI](https://github.com/xarleyn/dsh-plugins/actions/workflows/ci.yml/badge.svg)](https://github.com/xarleyn/dsh-plugins/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40yadsh%2Fdsh-draft-sessions.svg)](https://www.npmjs.com/package/@yadsh/dsh-draft-sessions)
[![npm downloads](https://img.shields.io/npm/dm/%40yadsh%2Fdsh-draft-sessions.svg)](https://www.npmjs.com/package/@yadsh/dsh-draft-sessions)
[![Node.js](https://img.shields.io/node/v/%40yadsh%2Fdsh-draft-sessions.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Persistent, unsent future conversations for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

`dsh-draft-sessions` is building the Cursor-like workflow where you can prepare several independent tasks, leave them unsent, and return to each task later without starting an agent.

[Русский](README.ru.md) · [简体中文](README.zh-CN.md) · [Specification](SPEC.md) · [Architecture](docs/architecture.md) · [Roadmap](ROADMAP.md)

## See it in action

### With `@michengai/dsh-automation`

Automation provides the optional cooperative tab host. When it is installed and active, Draft Sessions detects `__dshNativeTabs@1` and inserts `Drafts` between `Tasks` and `Scheduled`. There is no hard dependency on Automation and no load-order requirement.

<p align="center">
  <img src="docs/images/draft-sessions-hero.png" alt="Three independent draft sessions in a cooperative DeepSeek Harness sidebar tab" />
</p>

<p align="center"><em>With Automation installed, unsent tasks live in their own Drafts tab while Tasks and Scheduled keep their existing views.</em></p>

### On stock DeepSeek Harness

Without Automation or another compatible tab host, the standard workspace and session browser stays unchanged. Draft Sessions adds a footer action instead; clicking it opens the same draft list in a popover.

<p align="center">
  <img src="docs/images/draft-sessions-stock-fallback.jpg" alt="Draft Sessions footer action and popover on stock DeepSeek Harness" />
</p>

<p align="center"><em>The fallback uses the public sidebar footer slot and does not replace the stock workspace browser.</em></p>

### Draft actions

<p align="center">
  <img src="docs/images/draft-sessions-actions.png" width="360" alt="Draft session actions rendered above the sidebar without clipping or extra scrolling" />
</p>

<p align="center"><em>Create a distinct draft with <code>+</code>, then rename, duplicate, or delete it from the row menu.</em></p>

## Installation

Install the published npm package by name:

```bash
dsh plugin --profile web add @yadsh/dsh-draft-sessions
```

Or build and install the package from a local monorepo checkout:

```bash
pnpm --filter @yadsh/dsh-draft-sessions build
dsh plugin --profile web add ./plugins/dsh-draft-sessions
```

The published npm package is recommended when you do not need to modify the source.

To remove the plugin:

```bash
dsh plugin --profile web remove @yadsh/dsh-draft-sessions
```

## The intended experience

The original goal was to reproduce Cursor's inline draft experience: unsent tasks and ordinary sessions living together in one workspace tree.

```text
my-project
├─ ● Fix auth middleware
├─ ◌ Add Grafana dashboards       Draft
├─ ◌ Refactor docker entrypoint   Draft
└─ ● Implement notifications
```

That exact layout could not be reproduced through DSH's current public sidebar APIs without replacing the stock workspace browser. Draft Sessions keeps the important behavior—independent unsent tasks, exact text restoration, and conversion on the first accepted prompt—but exposes drafts in a cooperative `Drafts` tab when one is available, or through the stock sidebar footer popover otherwise.

Each draft owns a real blank DSH Session, but its unsent text is stored separately on the Host. If that blank Session disappears after a restart, a new shell can be created and rebound without losing the task.

```mermaid
flowchart LR
  UI["Sidebar draft row"] --> Composer["Standard DSH composer"]
  Composer --> Draft["DraftRecord — text authority"]
  Draft --> Session["Real blank DSH Session"]
  Session -->|"first prompt accepted"| Normal["Normal DSH Session"]
```

## What works now

- Host-backed JSON persistence under `$DSH_HOME/storages/dsh-draft-sessions/drafts.json`.
- Strict typed `draftSessions.list/create/update/delete/rebind` Remote methods.
- Independent workspace ordering and a configurable per-workspace limit.
- Optimistic revisions that reject stale browser writes.
- Atomic same-directory writes and strict durable-file validation.
- Distinct blank Session creation with the id persisted only after success.
- Missing Session detection and recovery rebinding without changing draft text.
- Accepted-Send observation with finalization only after `blank: false`.
- Rejected Send and blank slash-command preservation.
- Exact composer restore through the official per-session InputHub facade.
- Debounced optimistic autosave with a mandatory pre-switch flush.
- Draft creation from the Drafts `+` action or `Ctrl/Cmd + Shift + N`; both flush the active draft before opening a distinct one.
- A cooperative `Drafts` tab when the active sidebar host exposes `__dshNativeTabs@1`.
- A stock `sidebar.footer.action` trigger and popover when the tab protocol is absent.
- Portaled row menus, inline rename, duplicate, confirmed delete, keyboard navigation, and bounded drag reorder.
- Safe active-draft deletion with a final autosave flush and recovery after a rejected delete.
- Optional native-tab session filtering that hides draft shells without changing ordinary Sessions.
- No registration in the single-slot `sidebar.workspaces`; stock UI, Archive Manager, and other browser owners keep full control.
- Unit and DOM coverage for persistence, concurrency, lifecycle, composer, and sidebar behavior.

The current implementation deliberately does not send prompts, modify ordinary Session history, or delete blank Sessions.

## Requirements

- Node.js `^22.19.0` or `>=24.0.0`
- pnpm 10.4.1 for development
- DeepSeek Harness `>=0.1.1-rc.2 <0.2.0` with the public `sidebar.footer.action` list slot

The published rc.2 client is supported without patches. Sidebar tab hosts are detected through the optional versioned `__dshNativeTabs@1` cooperation protocol; the plugin falls back to the stock footer action instead of replacing the workspace browser.

## Development

From the monorepo root:

```bash
pnpm install --frozen-lockfile
pnpm --filter @yadsh/dsh-draft-sessions check
```

Build and link the checkout into a Web profile:

```bash
pnpm --filter @yadsh/dsh-draft-sessions build
dsh plugin --profile web add ./plugins/dsh-draft-sessions
dsh --profile web --dump-config
```

## Releases

This package uses independent Nx Version Plans from the monorepo. Add a plan with `pnpm release:plan`; maintainers publish verified tarballs through the shared [release workflow](../../docs/RELEASING.md).

## Configuration

The bundle inserts the `dsh-draft-sessions` Cordis row. Override it from the profile patch when needed:

```yaml
- id: dsh-draft-sessions
  config:
    # Blank uses $DSH_HOME/storages/dsh-draft-sessions/drafts.json
    storagePath: ""
    maxDraftsPerWorkspace: 50
```

## Current API

```ts
await ctx.remote.draftSessions.list({ workspaceId });

await ctx.draftSessionLifecycle.create({
  workspaceId,
  text: "",
});

await ctx.draftSessionLifecycle.ensureShell(draft);

await ctx.draftComposerBridge.open(draft);
await ctx.draftComposerBridge.flush();

await ctx.draftShortcutController.create(workspaceId);

await ctx.remote.draftSessions.update({
  id,
  expectedRevision: 4,
  text: "Add OTEL export",
});

await ctx.remote.draftSessions.rebind({
  id,
  expectedRevision: 5,
  sessionId: replacementSessionId,
});
```

The lifecycle service owns blank Session creation and recovery. The lower-level Remote methods remain available for storage operations; all mutations return the next `revision`, and a stale `expectedRevision` is rejected instead of silently overwriting another browser's edit.

## Design boundaries

- Draft text is authoritative in `DraftStore`; a blank Session is only an execution shell.
- Creating a draft must never make a model request.
- The first accepted prompt, not the Send button click, is the conversion boundary.
- Ordinary DSH Sessions remain owned entirely by DSH.
- Attachments are out of scope for v1; text and textual `@file` references come first.
- Draft rows compose beside the single workspace-browser occupant; the plugin never disables or embeds `ui-workspace`.
- Backing blank Sessions are excluded only from the workspace-browser slot, so the standard composer still receives the real current Session.

See [SPEC.md](SPEC.md) for acceptance criteria and [docs/architecture.md](docs/architecture.md) for the lifecycle.

## Contributing

Issues and focused pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and run the package check before submitting a change.

## License

[MIT](LICENSE). This is an independent community project and is not affiliated with or endorsed by DeepSeek.
