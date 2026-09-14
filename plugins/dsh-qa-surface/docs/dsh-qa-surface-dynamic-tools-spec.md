# SPEC / Implementation Plan: Dynamic QA Tool Activation for `dsh-qa-surface`

**Status:** Implemented (MVP) — see "Implementation notes" below  
**Target:** `xarleyn/dsh-plugins`, plugin `dsh-qa-surface`  
**Compatibility target:** DeepSeek Harness `dsh-v0.1.5-rc.2`  
**Primary goal:** keep the QA agent's default tool surface small, then dynamically attach the QA-specific tools only after the QA skill has actually been loaded.

---

## Implementation notes (0.5.0)

The subsystem lives in `plugins/dsh-qa-surface/src/qa-tools/` (`catalog.ts`,
`activation-manager.ts`, `activation-detector.ts`, `durable-marker.ts`,
`lifecycle.ts`, `types.ts`, `index.ts`), wired from `src/index.ts` as `QaTools`
and read by the admission gate in `src/secure-session.ts`.

Two deliberate departures from the plan as written:

1. **No custom session event (§11.1).** The durable marker is derived from the
   `skill` load the model already made — a standard `tool/call` paired with a
   successful `tool/result` — instead of a new `qa-surface/tools-activated`
   type. In `0.1.5-rc.2` `Session.append` cannot set `ignorable: true`, and the
   reader refuses any log carrying an unknown non-ignorable type; the repo's
   established reaction to that (`e0f213e`) is to keep plugin events out of
   session journals. Deriving the marker from standard events keeps a QA
   session readable by a plain DSH deployment and needs no `KNOWN_SESSION_EVENT_TYPES`
   registration that only works when reader and writer share one module instance.
   The consequence is that the marker records the skill load, not a catalog
   version; the catalog is reported by `qa_tools_selfcheck` and the operator log
   instead (§11.4's permissive policy already allows this).
2. **The shipped catalog is intentionally minimal** (`qa_tools_selfcheck`).
   `qa_report_sources` stays where it was: it is a subagent provenance fallback,
   and gating it behind a model-visible skill load would remove it from
   delegated children. The coupling that follows — a QA tool must be absent from
   `lockdown.toolPolicy.allow` (attestation validates that list against the
   mounted catalog before activation can run) and must instead be authorized by
   the execution guard — is implemented in `qaToolDenial(allowed, name,
dynamicNames)` and `QaPolicyAdmission`.

Implemented and covered by tests: catalog validation (unique names, passive
group/tag metadata), atomic per-agent registration with reverse-order rollback,
idempotency, two-agent isolation, real-registry scope visibility (including
survival of an `allow`-list restriction on inherited tools), skill-result
detection (wrong skill, failed load, unmanaged preset, repeat load), resume
restore from the session journal, disposal, and the dynamic-name guard.

Not implemented (out of scope for the MVP, as planned): group/`search`
activation modes, `qa_tools_search`, operator UI for tool-pack selection,
telemetry, and the schema-byte measurement in §23 phase 7.

---

## 1. Context

`dsh-qa-surface` is intended to provide a focused QA-facing surface while still using the native DeepSeek Harness Session and Agent Loop. The QA agent is expected to gain a relatively large toolset (potentially around 40 QA-related tools).

Registering all of those tools up front would make every model request carry their schemas even when the agent has not yet entered the QA workflow. That increases prompt/tool-schema size, makes the model-facing tool surface noisier, and can negatively affect tool selection.

DeepSeek Harness `dsh-v0.1.5-rc.2` already exposes the primitives required to avoid this:

- `ctx.tools.register(definition)` can register a tool globally or in the calling agent scope;
- registrations made through `agent.ctx.tools.register(...)` are scoped to that agent;
- tool schemas are resolved from the current scoped registry for model request assembly;
- `ctx.tools.restrict(...)` exists for filtering inherited/global tools and is the documented primitive for progressive disclosure;
- `tools/result` exposes the authoritative completed result of a tool invocation;
- the built-in `skill` tool returns a canonical object containing the loaded skill name, provider, content, and optional resource base;
- session events are append-only and extensible, allowing the plugin to persist the fact that QA tools were activated and reconstruct that state after resume.

The design should use those public extension points and should not patch the DSH core.

---

## 2. Decision summary

### MVP decision

Use **one QA skill** and activate the **entire QA toolset** after that skill is successfully loaded.

The implementation must **not** split the QA domain into many skills or require the model to search for and enable tool packs in the first version.

The lifecycle is:

```text
agent starts
  |
  | QA tools are NOT registered in the agent scope
  v
model sees ordinary tools + skill loader
  |
  | skill({ name: "<qa-skill-name>" }) succeeds
  v
plugin observes successful skill result
  |
  | atomically registers QA tools through agent.ctx.tools.register(...)
  v
next model step
  |
  v
QA tools are present in the model-visible tool schema
```

This gives the required progressive disclosure without making the first implementation unnecessarily complicated.

### Future-compatible decision

The internal catalog must support metadata such as `group`, `tags`, or `capability`, but the MVP activation policy ignores it and activates all QA tools together.

This leaves room for a later mode such as:

```text
all                 <- MVP
selected-groups     <- optional future mode
search-and-unlock   <- optional future mode
```

No `qa_tools_search`, capability-selection logic, BM25/embedding retrieval, or automatic group activation is required for the MVP.

---

## 3. Goals

The implementation must:

1. Keep QA-specific tool schemas out of the initial model request.
2. Activate QA tools only for the agent that loaded the QA skill.
3. Make the tools available starting with the model step after successful skill loading.
4. Be idempotent: repeated loading of the same skill must not duplicate registrations.
5. Recover correctly after browser/session resume.
6. Clean up all scoped registrations when the agent or plugin is disposed.
7. Fail closed on partial registration errors.
8. Keep tool implementation separate from activation policy.
9. Preserve compatibility with a future grouped/progressive tool catalog without implementing that behavior now.
10. Use only documented/public DSH plugin extension points where practical.

---

## 4. Non-goals for the MVP

The following are explicitly out of scope for the first implementation:

- splitting QA behavior into many skills;
- dynamically selecting individual tools based on the current user query;
- semantic/BM25 tool search;
- a model-facing `qa_tools_search` tool;
- a model-facing `qa_tools_enable` tool;
- unloading QA tools again during the same live QA session;
- automatically shrinking the QA tool surface after each task;
- using tool visibility as a security/authorization boundary;
- replacing DSH's native skill mechanism;
- patching `agent-loop`, `system-prompt`, or DSH core packages;
- globally registering all QA tools and then hiding them unless there is a concrete technical reason to do so.

The architecture should permit some of these later, but they should not add meaningful complexity to the MVP.

---

## 5. Important DSH behavior and constraints

### 5.1 Scoped registrations

The preferred mechanism is:

```ts
agent.ctx.tools.register(toolDefinition);
```

A registration made through the agent's scoped context belongs to that agent and shadows inherited/global tools with the same name.

For the QA tools this is preferable to global registration because the tools simply do not exist in the agent's resolved registry before activation.

### 5.2 `ctx.tools.restrict()` is not the primary MVP mechanism

`restrict()` filters inherited/global tools. It does **not** hide tools registered directly in the same agent scope.

Therefore:

- use late scoped `register()` for tools owned by `dsh-qa-surface`;
- reserve `restrict()` for a future requirement to hide/reveal tools registered globally by other plugins.

### 5.3 Tool schemas are assembled before `agent/pre-step`

In `dsh-v0.1.5-rc.2`, a model step roughly follows:

```text
claim input
assemble prompt sections + tool schemas
agent/pre-step
model request
execute tools
step/end
```

This matters for direct `/skill-name` user invocation. Activating tools from an `agent/pre-step` listener is too late to change the tool schemas that were already assembled for that same model step.

The normal model-invoked `skill(...)` flow does not have this problem: the skill tool runs in one step, activation happens after its successful result, and the following model step assembles the new QA tool schemas.

### 5.4 `tools/result` is the authoritative successful-result observation point

The built-in `skill` tool returns a canonical object similar to:

```ts
{
  name: string
  provider: string
  resourceBase?: ...
  content: string
}
```

Activation should be triggered only from a successful authoritative result whose tool name and returned skill name match the configured QA skill.

### 5.5 Visibility is not authorization

Dynamic registration/progressive disclosure reduces model-visible surface area. It is not a replacement for:

- approval policy;
- sandboxing;
- `tools/pre-execute` policy;
- `ctx.tools.guard(...)`;
- validation inside the individual tool;
- external-service authorization.

Any QA tool that can mutate state or call privileged services must retain its normal permission checks.

---

## 6. Proposed architecture

Keep the feature inside the current plugin/package for now, but implement it as a logically isolated subsystem so it can later be extracted into a separate package if necessary.

Suggested internal structure:

```text
plugins/dsh-qa-surface/
  src/
    host/
      qa-tools/
        catalog.ts
        activation-manager.ts
        activation-events.ts
        activation-detector.ts
        lifecycle.ts
        types.ts
        index.ts
        tools/
          ... actual QA tools ...
```

Adapt paths to the current repository structure instead of forcing this exact layout if the plugin already has a clearer Host organization.

### Components

#### `catalog.ts`

Owns the QA tool definitions and metadata.

It must not register tools itself.

#### `activation-manager.ts`

Owns per-agent runtime activation state, performs atomic scoped registration, cleanup, and restoration.

#### `activation-detector.ts`

Observes skill loading and requests activation when the configured QA skill successfully loads.

#### `activation-events.ts`

Defines a small durable session event representing QA capability activation.

#### `lifecycle.ts`

Hooks agent creation/session resume/disposal and connects reconstructed session state to `activation-manager`.

---

## 7. Tool catalog model

Do not expose 40 independent registrations at plugin boot.

Instead keep ordinary `ToolDefinition` objects in memory:

```ts
export interface QaToolDescriptor {
  readonly definition: ToolDefinition;

  // Metadata is intentionally present for future progressive activation.
  // MVP does not use it to filter the catalog.
  readonly group?: string;
  readonly tags?: readonly string[];
}

export const QA_TOOL_CATALOG: readonly QaToolDescriptor[] = [
  // ...
];
```

### Catalog rules

- Tool names should use a stable plugin-owned prefix when reasonable, e.g. `qa_*`.
- Tool names must be unique within the QA catalog.
- Catalog construction must be side-effect free.
- Creating the catalog must not register anything with `ctx.tools`.
- Group/tag metadata must not change MVP behavior.
- A future grouped activation implementation should be possible without modifying the actual tool definitions.

### Catalog version

Expose a deterministic catalog version, for example:

```ts
const QA_TOOL_CATALOG_VERSION = "1";
```

or a generated digest over tool names/schema identity if that is already easy to produce.

Do not over-engineer hashing in the first implementation. A manually bumped version is acceptable.

---

## 8. Activation state

Runtime state should be keyed by live `Agent` rather than only by session ID.

Suggested shape:

```ts
interface QaToolActivationState {
  status: "inactive" | "activating" | "active";
  catalogVersion?: string;
  disposers: Array<() => void>;
}

const states = new WeakMap<Agent, QaToolActivationState>();
```

A `WeakMap` is appropriate for live runtime ownership, but it is **not** sufficient for persistence. Durable activation state is handled separately through the session log.

---

## 9. Activation trigger

### 9.1 MVP primary path: model invokes the QA skill

Listen for the authoritative tool result:

```ts
ctx.on("tools/result", (exec, result) => {
  // inspect only successful top-level `skill` calls for this agent
});
```

Activation criteria:

1. `exec.agent` exists;
2. `exec.name === 'skill'`;
3. result is successful;
4. canonical result value is an object;
5. `result.value.name === configuredQaSkillName`;
6. the agent is one managed by the intended QA composition/preset if a reliable preset check is available;
7. the agent is not already active.

Do not activate merely because the model attempted `skill({name: ...})`.

A failed or cancelled skill load must not activate QA tools.

### 9.2 Skill name configuration

Avoid hard-coding the skill name in several files.

Suggested config:

```yaml
qaSurface:
  tools:
    dynamicActivation: true
    activationSkill: qa-surface
```

Use the actual config namespace conventions already established by the plugin. If the existing config schema uses a different root, integrate with it instead of adding an unrelated second namespace.

### 9.3 Direct user `/skill-name` invocation

The current `dsh-qa-surface` MVP rejects slash commands as ordinary QA input, so direct slash-skill activation is **not required for the first implementation**.

If operator-facing DSH sessions outside `/qa` need to support direct `/qa-surface`, treat that as a compatibility enhancement.

Important limitation: the built-in direct skill gesture is recognized in `agent/pre-step`, but tool schemas for that step have already been assembled. Therefore a listener that notices the injected `skill-invocation` in the same `agent/pre-step` cannot reliably make QA tools appear in that very request.

Acceptable future strategies:

- activate for the following step/turn;
- introduce an explicit bootstrap tool call;
- use a future DSH extension point if an earlier transactional pre-assembly hook becomes public.

Do not patch the agent loop solely to make direct slash invocation gain QA tools in the same request.

---

## 10. Atomic scoped registration

Activation must be effectively all-or-nothing from the plugin's point of view.

Pseudo-code:

```ts
function activateQaTools(agent: Agent): void {
  const current = states.get(agent);
  if (current?.status === "active" || current?.status === "activating") return;

  const state: QaToolActivationState = {
    status: "activating",
    disposers: [],
  };
  states.set(agent, state);

  try {
    validateCatalog(QA_TOOL_CATALOG, agent);

    for (const descriptor of QA_TOOL_CATALOG) {
      const dispose = agent.ctx.tools.register(descriptor.definition);
      state.disposers.push(dispose);
    }

    state.status = "active";
    state.catalogVersion = QA_TOOL_CATALOG_VERSION;
  } catch (error) {
    for (const dispose of state.disposers.reverse()) {
      try {
        dispose();
      } catch {}
    }

    states.delete(agent);
    throw error;
  }
}
```

### Preflight validation

Before the first registration, validate at least:

- duplicate names inside the QA catalog;
- reserved/invalid names if DSH exposes validation for them;
- obvious unintended collisions with existing scoped names;
- configuration consistency.

A global tool with the same name would be shadowed by a scoped registration, but accidental shadowing should not be silently accepted. Prefer a startup/activation error unless a tool is explicitly configured to shadow something.

### Error behavior

If tool 17 of 40 fails to register:

1. immediately dispose tools 1–16 in reverse order;
2. leave the agent in the inactive state;
3. do not append a durable `active` event;
4. log a concise error containing the failing tool name;
5. let the skill result itself remain valid; do not rewrite it into a false success/failure solely because optional QA tool attachment failed;
6. optionally inject/log a non-secret diagnostic for operators if the plugin already has an established mechanism for this.

No partially active QA tool surface should survive.

---

## 11. Durable activation and resume

This belongs in the MVP because `dsh-qa-surface` supports persistent/restored sessions.

If activation lives only in a `WeakMap`, this sequence breaks:

```text
session A loads QA skill
QA tools become active
browser/process/agent is recreated
session A is resumed
historical skill content remains in session
runtime QA registrations are gone
```

The session would then look like an already initialized QA conversation while lacking its tools.

### 11.1 Add a log-only session event

Use DSH's merge-extensible `SessionEventMap`.

Suggested event:

```ts
declare module "@deepseek-ai/dsh-session" {
  interface SessionEventMap {
    "qa-surface/tools-activated": {
      schemaVersion: 1;
      activationSkill: string;
      catalogVersion: string;
    };
  }
}
```

The event is log-only and must not become model-visible content.

### 11.2 Commit semantics

Append `qa-surface/tools-activated` **only after all scoped tool registrations succeeded**.

Runtime registration is the immediate capability commit; the session event is the durable reconstruction marker.

If appending the durable event fails after registration:

- prefer fail-closed cleanup: unregister the newly activated tools;
- report the activation as failed;
- do not leave a runtime-active state that cannot be reconstructed after resume.

### 11.3 Restore on agent lifecycle

Listen at an agent lifecycle point where the session is already attached and can be inspected before ordinary work begins. `agent/created` or `agent/session-start` are appropriate candidates; prefer the earliest public point that is stable with the current plugin composition.

Restoration logic:

```ts
if (session contains latest valid qa-surface/tools-activated event) {
  activateQaTools(agent, { restoring: true })
}
```

During restore:

- do not append a second activation event;
- validate supported `schemaVersion`;
- compare `catalogVersion`;
- if the catalog version changed, register the current catalog but log the version transition;
- do not fail every resumed session solely because an old optional metadata field is unreadable; malformed plugin-owned state should fail closed for QA tool activation and emit a useful diagnostic.

### 11.4 Catalog upgrade behavior

MVP policy:

- durable event says "QA capability was activated", not "exactly these 40 tools forever";
- on resume, activate the **current compatible catalog**;
- if a future breaking catalog migration needs stricter behavior, bump activation event `schemaVersion` and handle it explicitly.

This avoids storing dozens of tool names in every activation event.

---

## 12. Cleanup and lifecycle ownership

All registrations must be owned by the agent/plugin lifecycle.

Preferred approach:

- use `agent.ctx.effect(...)` where it makes lifecycle ownership clearer;
- store exact disposers returned by `register()`;
- dispose in reverse registration order;
- remove runtime bookkeeping on `agent/disposed` or as part of the agent-scoped effect teardown;
- plugin unload/HMR must leave no orphan scoped registrations.

The cleanup path must be safe when called more than once.

---

## 13. Why not register globally and use only `restrict()`?

That architecture is valid for inherited tools and is useful when a plugin needs to progressively expose tools owned by other plugins. It is not the cleanest option for QA tools owned by this plugin.

Late scoped registration has several advantages here:

- the QA tool is genuinely absent before activation;
- no deny-list needs to stay synchronized with the QA catalog;
- newly added QA tools cannot accidentally become visible because a deny list was not updated;
- lifecycle ownership is naturally per-agent;
- the intent is obvious in code.

`restrict()` should remain available as a second strategy for future integration with globally registered Jira/browser/MCP/etc. tools.

Possible future descriptor:

```ts
type QaCapabilityTool =
  | { kind: "owned"; definition: ToolDefinition; group?: string }
  | { kind: "inherited"; name: string; group?: string };
```

Do not implement this abstraction until there is an actual inherited-tool requirement.

---

## 14. Future optional progressive activation

The code should be structured so a future version can activate subsets without changing tool implementations.

Example future catalog metadata:

```ts
{
  definition: qaApiAssert,
  group: 'api-testing',
  tags: ['api', 'assertion'],
}
```

A later `activationMode` could be:

```ts
type QaToolActivationMode = "all" | "groups";
```

or eventually:

```ts
"all" | "groups" | "search";
```

### Explicitly deferred future work

Potential later improvements:

- capability groups such as `api`, `browser`, `requirements`, `bugs`, `reporting`;
- a small bootstrap toolset plus on-demand group unlock;
- a `qa_tools_search` retriever;
- BM25/semantic matching;
- usage-based group eviction;
- per-task activation telemetry;
- comparing prompt-schema bytes/tokens and cache behavior before/after activation.

For now, only preserve metadata boundaries that make these additions non-breaking.

---

## 15. Configuration

Keep config intentionally small.

Proposed shape, adapted to the plugin's existing schema:

```yaml
qa-surface:
  tools:
    dynamicActivation: true
    activationSkill: qa-surface
    activationMode: all
```

### Fields

#### `dynamicActivation`

- type: boolean
- default: `true` once the feature is stable;
- when `false`, choose one explicit compatibility behavior:
  - either register all QA tools immediately for the managed agent;
  - or disable QA tool contribution completely.

Prefer immediate registration as the migration/debug compatibility mode if QA tools were previously always-on.

#### `activationSkill`

- exact skill name that unlocks QA tools;
- validate with the same public skill-name grammar when practical.

#### `activationMode`

- MVP accepted value: `all`;
- reserve the field so future `groups`/`search` modes do not require a config redesign.

Do not expose UI controls for group selection in the MVP.

---

## 16. Integration with `agentPreset`

The existing `dsh-qa-surface` design already treats the UI as presentation and expects system prompt, tools, skills, knowledge connections, and permissions to be supplied by the selected agent preset.

Preserve that separation.

The QA surface should not silently give every arbitrary DSH agent the QA tool catalog merely because the Host plugin is installed.

Recommended ownership options, in priority order:

1. mount the dynamic QA-tool subsystem as part of the QA agent preset/composition;
2. if it must remain root-mounted, explicitly detect that the agent belongs to the configured QA preset/session before activating;
3. avoid a process-global listener that activates any agent which happens to load a skill with the same name.

The exact preset-detection implementation should follow the APIs already used in the repository rather than introducing private DSH internals.

---

## 17. Interaction with the current `/qa` UI

No major UI feature is required.

The UI may optionally surface tool activity if its existing `showToolActivity` path already supports generic DSH tools. Dynamic QA tools should flow through the normal native tool-call/session event path.

Do not add a second custom QA-tool execution protocol.

Possible later operator diagnostics:

```text
QA tools: inactive
QA tools: active (40 tools, catalog v1)
```

This is optional and should not block the backend MVP.

---

## 18. Logging and observability

Add concise structured logs around state transitions.

Recommended events:

```text
qa-tools activation requested agent=<id> skill=<name>
qa-tools activated agent=<id> tools=<count> catalog=<version>
qa-tools restored agent=<id> catalog=<version>
qa-tools activation failed agent=<id> tool=<name> error=<message>
qa-tools disposed agent=<id>
```

Do not log:

- secrets;
- complete tool arguments/results;
- full skill content;
- credentials or external-service tokens.

Optional future metrics:

- activation count;
- activation failures;
- number of registered QA tools;
- schema bytes before/after activation;
- number of model calls before activation;
- token/cache comparison.

Metrics are not required for the MVP unless the repository already has a trivial telemetry helper.

---

## 19. Security requirements

1. Tool activation must not bypass existing approval or guard layers.
2. Hidden/inactive tools must not be considered an authorization mechanism.
3. QA tools that perform writes must independently enforce their normal permission rules.
4. Activation must be scoped to the intended agent.
5. A skill with a coincidentally matching display text must not trigger activation; match the canonical successful `skill` result name.
6. External/user content must not be able to forge the durable activation event through model-visible text.
7. Restored activation markers must be validated before use.
8. Do not auto-approve approval requests from the `/qa` surface as part of this feature.

---

## 20. Failure handling

### Skill fails to load

Result: no activation.

### Skill succeeds, one QA tool fails to register

Result: rollback all registrations from this activation attempt; remain inactive.

### Durable activation event cannot be appended

Result: rollback runtime registrations; remain inactive.

### Resume finds no activation event

Result: remain inactive even if unrelated old text mentions the QA skill.

### Resume finds valid activation event

Result: restore current QA catalog before the agent continues ordinary work.

### Resume finds unsupported activation event schema version

Result: fail closed for dynamic QA tools and emit a clear compatibility warning.

### Plugin unload/HMR

Result: all registrations unwind through Cordis/agent-scoped effects.

### Repeated QA skill load

Result: no-op activation; do not duplicate registrations or durable events unless a catalog migration explicitly requires a new record.

---

## 21. Testing plan

### 21.1 Unit tests: catalog

Test:

- unique names;
- deterministic catalog count/version;
- optional group metadata does not affect MVP selection;
- catalog creation performs no registration.

### 21.2 Unit tests: activation manager

Test:

- inactive -> active registers every QA tool once;
- second activation is idempotent;
- registration failure rolls back earlier registrations;
- disposal unregisters everything;
- duplicate/collision preflight fails before partial activation where possible.

### 21.3 Integration test: initial tool surface

Create QA agent/session before loading the skill.

Assert:

- ordinary baseline tools are visible;
- `skill` is visible if provided by the preset;
- QA-specific tools are absent from `ctx.tools.schemas(...)/resolved model request`.

Prefer asserting the actual model request/tool schema snapshot rather than only inspecting internal state.

### 21.4 Integration test: model skill activation

Simulate:

```text
model -> skill({ name: qa-surface })
```

Assert:

- the skill result succeeds;
- the activation event is recorded;
- the next model request contains QA tool schemas;
- the previous model request did not contain them.

This is the main acceptance test.

### 21.5 Integration test: wrong skill

Load another skill.

Assert no QA activation.

### 21.6 Integration test: failed skill

Unknown/disabled QA skill or forced provider failure.

Assert no activation event and no QA registrations.

### 21.7 Integration test: resume

1. create session;
2. load QA skill;
3. verify QA tools active;
4. dispose live agent;
5. resume same session;
6. verify QA tools are restored before the next ordinary request.

This is mandatory for the MVP.

### 21.8 Integration test: multi-agent isolation

Create agents A and B.

Activate QA skill only in A.

Assert:

- A sees QA tools;
- B does not;
- disposing A does not affect B;
- activating B later creates its own registrations.

### 21.9 HMR/plugin teardown test

If the repository has Cordis lifecycle test helpers:

- activate QA tools;
- unload/reload the plugin;
- assert no duplicate registrations or leaked state.

### 21.10 Tool-security regression

For at least one guarded/approval-requiring QA tool, confirm dynamic activation does not skip the normal tool execution policy.

---

## 22. Acceptance criteria

The feature is complete when all of the following are true:

- [ ] QA-specific tool schemas are absent before QA skill activation.
- [ ] Successful canonical loading of the configured QA skill activates all QA tools for that agent.
- [ ] QA tools appear in the immediately following model step.
- [ ] Loading unrelated skills does not activate them.
- [ ] Failed/cancelled QA skill loading does not activate them.
- [ ] Repeated skill loads do not duplicate tool registrations.
- [ ] Two concurrent agents have independent activation state.
- [ ] Partial activation errors roll back cleanly.
- [ ] Activation survives session/agent resume through durable state reconstruction.
- [ ] Plugin/agent teardown unregisters the scoped tools.
- [ ] Existing approval/sandbox/guard behavior still applies.
- [ ] The internal catalog supports optional group/tag metadata, but no grouped activation UX/logic is required.
- [ ] No DSH core patch is required.

---

## 23. Suggested implementation sequence

### Phase 1 — Inventory and extraction

1. Identify every QA-specific tool planned for the plugin.
2. Ensure tool definitions can be constructed without immediately registering themselves.
3. Move them behind one `QA_TOOL_CATALOG` export.
4. Add catalog validation tests.

### Phase 2 — Scoped activation manager

1. Add per-agent state.
2. Implement atomic `agent.ctx.tools.register(...)` loop.
3. Add rollback and disposer ownership.
4. Add idempotency tests.

### Phase 3 — Skill-result detector

1. Subscribe to `tools/result`.
2. Match successful `skill` result and exact QA skill name.
3. Call activation manager.
4. Verify QA tools appear only on the next model step.

### Phase 4 — Durable resume support

1. Add `qa-surface/tools-activated` to `SessionEventMap`.
2. Append marker only after complete activation.
3. Restore activation during agent/session lifecycle.
4. Add dispose/resume integration tests.

### Phase 5 — Plugin/preset scoping

1. Ensure only intended QA-composed agents participate.
2. Verify ordinary DSH sessions remain unchanged.
3. Test two concurrent sessions/presets.

### Phase 6 — Compatibility/config

1. Add `dynamicActivation` and `activationSkill` config.
2. Reserve `activationMode: all`.
3. Document behavior and limitations.
4. Add a temporary always-on fallback only if needed for migration/debugging.

### Phase 7 — Measurement

Before merge, capture at least one reproducible comparison:

```text
before skill: N visible tools / X schema bytes
 after skill: N+QA visible tools / Y schema bytes
```

Token measurement is useful but not mandatory if provider tokenization is awkward. Canonical serialized tool-schema bytes are sufficient to prove the feature actually reduces initial surface size.

---

## 24. Future roadmap hook: capability groups

Do not implement this in the first version, but preserve this conceptual seam:

```ts
interface QaToolDescriptor {
  definition: ToolDefinition;
  group?: QaToolGroup;
  tags?: readonly string[];
}
```

A later activation policy can change from:

```ts
catalog.filter(() => true);
```

to:

```ts
catalog.filter((tool) => enabledGroups.has(tool.group));
```

without rewriting individual tools.

Possible future groups:

```text
requirements
api-testing
browser-testing
exploratory
bug-analysis
reporting
```

These are organizational metadata only until a concrete need justifies exposing them to the model.

---

## 25. Notes for the coding agent

- Do not assume `agent/pre-step` can mutate the already assembled tool schema for the same request.
- Prefer canonical result objects/events over parsing rendered tool text.
- Do not parse the rendered `<skill_content>` text to decide whether activation occurred.
- Do not scan arbitrary conversation text for the skill name.
- Do not globally register QA tools merely to simplify implementation.
- Do not use `ctx.tools.restrict()` to hide agent-owned scoped registrations; restrictions do not apply to the scope's own tools.
- Preserve exact disposers returned by DSH/Cordis registrations.
- Treat registration rollback and resume tests as part of the feature, not optional hardening.
- Keep future grouping metadata passive in MVP; no hidden retrieval framework should be smuggled into the first implementation.
- Follow the repository's existing configuration and test conventions instead of creating a parallel framework.

---

## 26. Verified upstream references

The implementation plan is based on public behavior present in DeepSeek Harness `dsh-v0.1.5-rc.2`:

- Tool registry / scoped registration / restrictions:  
  https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/docs/subsystems/tools.md

- DSH architecture and step ordering:  
  https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/docs/architecture.md

- Extension cookbook; `ToolSearch / progressive disclosure` points to scoped `ctx.tools.restrict()` replacement:  
  https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/docs/cookbook/extension-cookbook.md

- Built-in skill tool implementation and direct `/name` skill invocation handling:  
  https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/packages/skill/tool-skill/src/index.ts

Current `dsh-qa-surface` package behavior should remain consistent with its existing architectural principle: `/qa` is a presentation surface backed by native DSH sessions, while system prompt, tools, skills, knowledge integrations, and permission policy belong to the agent composition/preset.

---

## 27. Final implementation recommendation

Implement **late, agent-scoped registration of the complete QA tool catalog after successful QA skill loading**, backed by a small durable activation event for session resume.

Keep optional `group`/`tags` metadata in the catalog so a future release can introduce finer progressive disclosure, but do not expose or implement that complexity now.

In short:

```text
one QA skill
    -> successful load
    -> activate all QA tools for this agent
    -> persist activation marker
    -> restore on resume

future only:
    -> groups/search/selective activation
```

This is the smallest design that solves the current tool-schema bloat problem while leaving a clean path to more granular progressive disclosure later.
