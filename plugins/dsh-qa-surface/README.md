# @yadsh/dsh-qa-surface

A focused, responsive QA/chat page for DeepSeek Harness at `/qa`. It replaces
the presentation, not the harness: prompts, streaming, tools, skills, MCP,
memory, persistence, permissions and telemetry continue through the native DSH
Session and Agent Loop.

## What it does

- contributes one root-scoped entry to the additive `shell.overlay` slot;
- stays invisible outside the configured route;
- creates or restores one real DSH Session;
- renders only user text, assistant-visible text and safe status messages;
- supports streaming, Stop, New chat, safe Markdown and mobile layouts;
- blocks unsupported approvals/questions instead of auto-approving them;
- uses the existing same-origin DSH connection and trust boundary.

It does not add another HTTP server, provider proxy, permissive CORS rule, or
custom session persistence.

## Install

Install the package where the DSH Host can resolve it, then compose its Loader
row. The included `cordis.patch.yml` is a minimal example:

```yaml
- insert:
    - id: dsh-qa-surface
      name: "@yadsh/dsh-qa-surface"
      config:
        enabled: true
        route:
          path: /qa
          matchChildren: true
```

Some DSH patch operations replace a row's complete `config` instead of deeply
merging it. When editing an existing row, provide every value that deployment
needs.

DSH `0.1.1-rc.2` serves unknown frontend paths as 404 rather than falling back
to `index.html`. The Host half therefore claims only the configured QA
navigation path and redirects it through the canonical `/` document with a
short-lived query marker. The browser restores the requested `/qa` URL with
`history.replaceState` before mounting the overlay. No second server, duplicate
HTML document, permissive route, or unauthenticated config endpoint is added.

## Configure

Configuration is registered under the Host settings namespace `qa-surface`.
Composition values form the base layer; normal DSH user settings can override
them when the deployment provides writable settings.

```yaml
config:
  enabled: true
  route:
    path: /qa
    matchChildren: true
  branding:
    title: Internal Assistant
    subtitle: Answers about the internal platform
    welcomeMessage: How can I help?
    placeholder: Ask a question...
    logoUrl: null
  session:
    policy: browser-persistent
    storageKey: dsh-qa-surface
    workspaceId: company-knowledge
    fixedSessionId: null
    agentPreset: qa-assistant
    provider: null
    model: null
    reasoningEffort: null
  ui:
    showHeader: true
    showReset: true
    showStop: true
    showTimestamps: false
    showToolActivity: false
    showReasoning: false
    renderMarkdown: true
    maxContentWidth: 900
  suggestedQuestions:
    - How do I request access?
    - Where is the runbook?
  interaction:
    approvals: blocked
    questions: unsupported
```

`workspaceId` is recommended for a deterministic assistant. Without it, DSH
uses the Host's normal default working directory. Put the system prompt, tools,
skills, knowledge connections and permission policy in `agentPreset`, not in
this UI plugin.

Model override is opt-in: `provider` and `model` must be set together. Slash
commands are rejected as plain QA input in this MVP. `showReasoning: true` is
also rejected; raw reasoning is intentionally outside the safe MVP surface.

Session policies:

- `browser-persistent` restores the id stored in this browser, replacing stale
  ids with a new session;
- `new-on-load` creates a session each time the QA surface mounts;
- `fixed` requires `fixedSessionId`, never creates a replacement, and is meant
  only for controlled single-user deployments.

New chat creates another DSH Session and leaves the old one intact for operator
inspection.

## Security and deployment

`/qa` is a presentation boundary, not an authentication boundary. Protect it
with the same deployment authentication and DSH browser trust policy as the
operator UI. The plugin never auto-approves a permission request or answers an
interactive agent question. Configure a least-privilege, non-interactive agent
preset for end-user deployments.

The `embedding.frameAncestors` field is reserved deployment metadata in 0.1.x;
the plugin does not mutate CSP headers. Configure `frame-ancestors` at the
trusted reverse proxy if iframe embedding is required.

See [Architecture](docs/ARCHITECTURE.md),
[Configuration](docs/CONFIGURATION.md), and
[Compatibility](docs/COMPATIBILITY.md).

## Develop

```text
pnpm --filter @yadsh/dsh-qa-surface check
```

The package publishes a classic DSH browser module whose loader id is the full
package name, `@yadsh/dsh-qa-surface`.
