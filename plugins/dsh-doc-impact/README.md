# dsh-doc-impact

Deterministic documentation-impact enforcement for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

The plugin links code and documentation into a declarative impact graph. When an
agent changes files during a turn, `dsh-doc-impact` diffs the workspace against
the turn baseline, matches the delta against project rules, and — before the
turn closes — steers the agent to review or update the affected documents.
Implementing the plugin as a standard Cordis extension means no DSH core
changes (SPEC §14, §93).

```text
packages/auth/src/session.ts changed

→ docs/authentication.md
→ docs/security/session-lifecycle.md
```

## Install

```bash
dsh plugin --profile web add link:/path/to/dsh-doc-impact   # local checkout
# or, once published:
dsh plugin --profile web add @yadsh/dsh-doc-impact
```

Then restart the harness so the plugin is loaded.

## Workspace configuration

Create `.dsh/doc-impact.yml` in the project the agent works on:

```yaml
version: 1

defaults:
  mode: remind            # remind | require-review | require-resolution | require-update
  scope: turn             # turn | session
  changeDetection: auto   # auto | git | filesystem

rules:
  - id: auth-docs
    description: Authentication behavior documentation
    code:
      include:
        - packages/auth/**
        - packages/server/src/auth/**
      exclude:
        - "**/*.test.ts"
    docs:
      - docs/authentication.md
    direction: code-to-docs     # code-to-docs | docs-to-code | bidirectional
    relation: documents         # documents | specification | synchronized | related
    mode: require-resolution

  # Concise form is also accepted:
  - id: configuration-contract
    code: [packages/config/**]
    docs: [docs/configuration.md]
    direction: bidirectional
    relation: specification
```

Personal overrides belong in `.dsh/doc-impact.local.yml` (add it to
`.gitignore`):

```yaml
disabledRules:
  - legacy-docs
```

### Plugin-level defaults (profile patch)

```yaml
- insert:
    - id: doc-impact
      name: dsh-doc-impact
      config:
        enabled: true
        configFile: .dsh/doc-impact.yml
        defaults:
          mode: remind
        safety:
          maxReminderRounds: 2
          onLimit: allow        # allow | warn | error
        changeDetection:
          maxSnapshotFiles: 10000
        debug: false
```

## How it works

1. **Baseline** — at the turn's first step the plugin records HEAD and the
   content hashes of every already-dirty file (git mode) or of all
   selector-matched files (filesystem fallback). Pre-existing user changes are
   therefore never attributed to the agent (SPEC §16-§19).
2. **Stop check** — on `agent/turn-stopping` the plugin diffs the workspace
   against the baseline (including commits the agent made mid-turn), matches
   the delta against the rules, and auto-resolves impacts whose targets were
   updated (SPEC §31, §88).
3. **Steer** — unresolved impacts produce one grouped reminder, and the agent
   gets another model step to update or review the documents.
4. **Resolve** — for strict modes the agent calls
   `doc_impact_resolve { ruleId, status, reason? }` with `reviewed-current`,
   `updated` (verified against the actual file delta), or `not-applicable`
   (non-empty reason required).
5. **Loop protection** — `remind` steers once per impact fingerprint; strict
   modes stop after `maxReminderRounds` and honor `onLimit` (fail-open by
   default, SPEC §34-§36).

## Commands and tools

| Interface | Purpose |
|---|---|
| `/doc-impact` | current pending/resolved status |
| `/doc-impact check` | recompute impacts now |
| `/doc-impact explain <ruleId>` | show one rule and whether it is triggered |
| `/doc-impact changed` | files the plugin attributes to this agent |
| `doc_impact_resolve` | explicit resolution tool (strict modes) |
| `doc_impact_status` | read-only status tool |

## Plugin Configuration UI

The plugin ships a browser half (`lib/client.js`, `exports "./client"`), so
**Settings → Plugins → Plugin Configuration** shows a "Doc Impact" card bound
to the `doc-impact` settings namespace. It follows the first-party card model:

- staged edits — nothing writes before **Save**; **Discard** drops drafts;
- the header carries an **unsaved** badge while drafts exist;
- **Save** stays disabled until there is something to write (and while a draft
  is invalid or a save is in flight);
- every field shows whether saving would leave a user-layer override and, when
  one stands, a per-field **Reset** that reverts to the composition layer.

Editable fields: `enabled`, `configFile`, default `mode`, `maxReminderRounds`,
`onLimit`, `maxSnapshotFiles`, `debug`. The profile patch row's `config:` acts
as the composition base under these user edits; the engine reads the merged
view live (toggling `enabled` silences the plugin without a restart).

## Development

```bash
npm install
npm run check   # typecheck + tests + build
```

The core (`src/config`, `src/graph`, `src/changes`, `src/engine`) is
DSH-independent and testable without the harness; only `src/dsh` imports
`@deepseek-ai` packages (SPEC §83, §92). Integration tests exercise real git
repositories, including the Definition-of-Done scenario (SPEC §95).

## Status

MVP scope per SPEC §80: code-to-docs / docs-to-code / bidirectional rules,
glob include/exclude, git + filesystem baseline detectors, `agent/turn-stopping`
continuation, reminder aggregation, `remind` + `require-resolution` (plus
`require-review` / `require-update` modes), loop protection, commands, unit and
integration tests.

## License

[MIT](LICENSE)
