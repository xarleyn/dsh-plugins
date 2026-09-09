# Configuration reference

Defaults and constraints are documented in the root README. Important runtime
rules are:

- `route.path` starts with `/`, has trailing slashes removed, and cannot claim
  `/`, `/api` or `/plugins`;
- `fixed` requires `fixedSessionId`;
- `provider` and `model` are either both absent or both present;
- `maxContentWidth` is an integer from 480 through 1600;
- duplicate/blank suggested questions are removed;
- approval and question policies are fixed to safe blocking behavior;
- reasoning and tool details are opt-in through `ui.showReasoning` and
  `ui.showToolActivity`; enable them only where those contents are appropriate
  for the QA audience;
- lockdown defaults to enabled and requires a non-empty permission preset;
- the preset must resolve on the Host to exactly `read-only` + `never`;
- permission, slash-command, settings, rename, delete and arbitrary-open
  capability flags cannot be enabled;
- `showReset` requires the independent `allowSessionReset` opt-in;
- the tool policy is an allow-list; unknown configured tool names fail closed.
  A name only resolves while its tool is actually mounted: MCP tools
  (`mcp__<server>__*`) exist only while their server is reachable, so keep
  them out of the allow list on hosts that cannot reach the server. Tools
  mounted by an agent preset live in that preset's ancestor scope; the Host
  validates and restricts the complete agent-scoped view, not just globals.

Browser persistence stores only the DSH session id under
`<storageKey>:v1:<route>:session`, plus — when `ui.showSessionList` is
enabled — a per-browser chat index under `<storageKey>:v1:<route>:chats`
(session ids only, capped at 50). Transcript content, credentials and tool
results remain in the Host-owned DSH Session and are never copied to browser
storage.

When either work-detail flag is enabled, the QA transcript groups reasoning,
intermediate assistant progress, and tool rows by DSH turn. Running work is
expanded. Completed work is collapsed behind a duration summary and can be
reopened; each tool row can separately reveal its formatted input and output.
These controls change presentation only and never widen the Host allow-list.

The browser cannot override lockdown settings. Before binding and immediately
before every prompt, it requests a Host attestation for the selected session.
Any unproved agent preset, workspace, model, permission bundle or tool policy
disables Send with the generic message `Настройки помощника недоступны.`
Detailed mismatch facts are written only to Host logs; the
browser console additionally prints one line with a stable coarse reason code
(`reason: unknown-tools`, `composition-mismatch`, `permission-preset`,
`adoption-refused`, `proof-mismatch` or `attestation-failed`) plus an operator
hint, so a refused surface can be diagnosed without Host log access.

The built-in branding, controls, status messages and accessibility labels are
Russian. The default quick questions are rendered directly above the composer
only while the current chat is empty. Set `suggestedQuestions: []` to hide
them, or provide a deployment-specific list to replace them.

When adding tools, update the deployment's reviewed capability inventory as
part of the same change. The package's
[default inventory](../capability-policy.json) is intentionally empty, matching
the default `toolPolicy.allow`.

## Configuration channel over the LAN

The browser normally reads the effective configuration from the Host-owned
`qa-surface` settings namespace. DSH pins settings RPCs to loopback, so a
browser served over the LAN always sees that namespace as unavailable. In
that case the client calls the plugin's `qaSurface/describe` Host Remote and
uses the returned effective configuration; a rejected call falls back to the
client defaults with the same `unavailable` status as before. Only one
describe request runs per page load, and a settled answer survives scope
updates — the namespace (when readable) stays the authority and keeps
delivering live changes.

Host-side enforcement never depended on the browser's read path: `secureSession`
attestation re-derives everything from the Host-owned configuration on every
bind and every prompt.

## Skill catalog scope

The deployment's agent preset controls which skills the QA assistant sees.
The shipped `qa-research` preset mounts the skill filesystem with
`includeDefaultRoots: false`: project-root skills (for example the harness
checkout's own `.dsh/skills`) and user-home skills stay out of the catalog,
and skills enter only through plugin providers or an explicit
`customSkillDirs` list in the preset. Keep the QA catalog to exactly the
skills the audience is meant to use.

## Deleting chats

The sidebar delete control removes a chat from this browser's index only;
the Host session stays on disk. Deleting the chat that is currently open
continues in a fresh attested session when `lockdown.allowSessionReset` is
enabled. There is no Host session-deletion API in DSH 0.1.x for the plugin
to call.
