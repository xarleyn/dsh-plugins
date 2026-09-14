# SPEC / PLAN — QA Surface Panel Extension API

**Target:** `@yadsh/dsh-qa-surface`  
**Repository baseline:** `xarleyn/dsh-plugins`, branch `dsh-v0.1.5-rc.2`  
**Target DSH:** `0.1.5-rc.2`  
**Status:** implementation specification  
**Primary goal:** turn `/qa` into a small extension host for optional side panels without coupling QA Surface to Browser, Logs, Artifacts, Trace Viewer, or any other concrete feature.

---

## 1. Summary

`dsh-qa-surface` should own only the presentation shell of `/qa`:

- chat / conversation surface;
- optional right-side panel region;
- panel launcher;
- width and responsive behavior;
- lifecycle of registered panel bodies;
- a small navigation API: register, open, close, toggle, inspect active panel.

Concrete panel implementations must live in separate plugins.

The first consumer is expected to be `@yadsh/dsh-qa-browser`, but the API must be generic enough for future panels such as:

- artifacts;
- test reports;
- trace viewer;
- plugin logs;
- context inspector;
- session diagnostics;
- terminal;
- custom organization-specific UI.

The design intentionally follows the architectural pattern used by the current DSH right sidebar:

1. metadata/registration is separate from UI body registration;
2. the shell owns layout and navigation;
3. extension bodies own their own controls and feature state;
4. registration lifetime follows plugin lifetime;
5. the shell does not import or know concrete extensions.

This SPEC does **not** copy DSH's full docking engine. QA Surface needs a much smaller contract.

---

## 2. Problem

Today QA Surface is a focused presentation layer around a native DSH Session/Agent Loop.

Adding Browser directly into `dsh-qa-surface` would force QA Surface to own:

- Playwright/CDP dependencies;
- browser process lifecycle;
- browser sessions/tabs;
- screenshots and screencast;
- network/console state;
- browser-specific security;
- browser tool schemas;
- browser artifacts;
- browser-specific UI.

That would make a deliberately small presentation plugin responsible for a large agent capability.

Instead, QA Surface needs one generic extension seam.

The desired dependency direction is:

```text
@deepseek-ai/dsh
        ▲
        │
@yadsh/dsh-qa-surface
        ▲
        │ panel contract
        │
@yadsh/dsh-qa-browser
```

Not:

```text
dsh-qa-surface
 ├── chat
 ├── browser runtime
 ├── playwright
 ├── devtools
 ├── artifacts
 └── every future panel
```

---

## 3. Design goals

### 3.1 Functional goals

The implementation MUST:

- allow another client plugin to register a panel type;
- allow the registered plugin to provide the panel body through a keyed UI extension point;
- render a launcher only for currently registered user-visible panels;
- allow an extension to open/reveal itself programmatically;
- preserve the QA chat while a desktop panel is open;
- reserve real layout width instead of drawing an overlay on desktop;
- support fullscreen panel presentation on narrow/mobile layouts;
- allow an extension to request that its body stays mounted while hidden;
- cleanly unregister a panel when its plugin unloads;
- keep panel presentation state out of the DSH Session log;
- work when no extensions are installed;
- keep QA Surface free of dependencies on concrete panel plugins.

### 3.2 Architectural goals

The API SHOULD:

- resemble native DSH extension conventions;
- be small enough to stabilize and version;
- use plugin-lifetime disposal;
- separate serializable/static metadata from React body implementation;
- not pass arbitrary React component values through the service registry;
- avoid a custom plugin/module loader;
- avoid a new HTTP server or transport;
- avoid dependence on DSH's internal `ui-dockkit` implementation.

### 3.3 UX goals

Desktop behavior:

```text
┌─────────────────────────────────────────────────────────────────┐
│ QA header                                      [panel launchers] │
├───────────────────────────────────┬─────────────────────────────┤
│                                   │ panel header             × │
│                                   ├─────────────────────────────┤
│             QA CHAT               │                             │
│                                   │      extension body         │
│                                   │                             │
│                                   │                             │
├───────────────────────────────────┴─────────────────────────────┤
│ composer                                                        │
└─────────────────────────────────────────────────────────────────┘
```

Mobile/narrow behavior:

```text
┌──────────────────────────────┐
│ panel header              ×  │
├──────────────────────────────┤
│                              │
│      extension body          │
│                              │
└──────────────────────────────┘
```

Closing the mobile panel returns to the same QA chat without remounting/recreating the DSH Session.

---

## 4. Non-goals

Version 1 MUST NOT implement:

- recursive docking;
- multiple simultaneous side panes;
- floating windows;
- drag-and-drop tab movement;
- split trees;
- undo/redo layout history;
- generic resource routing;
- a file-preview system;
- a second DSH right sidebar;
- cross-window popouts;
- generic host-side services;
- Browser itself;
- Browser approval policy;
- browser streaming;
- generic extension settings UI.

If future requirements demand several simultaneous panels, evolve the extension host after concrete evidence. Do not pre-build `ui-dockkit`.

---

## 5. Upstream DSH precedent

Current upstream DSH provides a useful reference architecture for its native right sidebar:

- a panel/surface owns layout;
- a registry owns tab-type metadata;
- the body is supplied through a keyed extension seat;
- a registration returns a disposer and follows plugin lifetime;
- the panel body owns feature-specific controls;
- hidden content can remain mounted;
- navigation is provided through a service rather than direct imports between features.

QA Surface should copy these **principles**, not the full implementation.

Important constraint:

> `dsh-qa-surface` MUST NOT depend on the native right-sidebar package as its panel engine.

Reasons:

- `/qa` is a separate presentation surface;
- the native right sidebar has substantially broader docking semantics;
- importing it would couple QA Surface to upstream UI internals;
- the desired QA contract is intentionally smaller and easier to keep compatible.

---

## 6. Proposed package API

The exact module augmentation/import paths MUST be aligned with the existing plugin conventions in the target branch during implementation.

The public semantic contract is defined below.

### 6.1 Panel identity

Use two identifiers:

- `id`: implementation identity, globally unique;
- `kind`: logical feature identity used for navigation.

Example:

```ts
{
  id: '@yadsh/dsh-qa-browser',
  kind: 'browser'
}
```

`id` is expected to remain unique even if a future plugin replaces another implementation of the same `kind`.

For v1, duplicate `kind` registration SHOULD be rejected unless replacement semantics are explicitly added later.

### 6.2 Definition

```ts
export interface QaSurfacePanelDefinition {
  /**
   * Globally unique implementation id.
   * Prefer the package name.
   */
  id: string

  /**
   * Stable logical panel kind.
   * Examples: browser, artifacts, logs.
   */
  kind: string

  /**
   * User-facing title.
   * Resolve through the plugin's own localization layer.
   */
  title: () => string

  /**
   * Optional description used in an overflow/picker UI.
   */
  description?: () => string

  /**
   * Stable presentation token.
   * QA Surface maps known tokens to its own icon set and uses
   * a generic fallback for unknown values.
   */
  icon?: string

  /**
   * Ordering in the QA header/launcher.
   */
  order?: number

  /**
   * Whether the user can open it manually.
   * Programmatic open may still be allowed when false.
   *
   * Default: true.
   */
  userVisible?: boolean

  /**
   * Keep the panel body mounted after it stops being active.
   * Required for extensions with expensive/continuous local state.
   *
   * Default: false.
   */
  keepMounted?: boolean
}
```

### 6.3 Registry/navigation service

Proposed public service:

```ts
export interface QaSurfacePanels {
  register(definition: QaSurfacePanelDefinition): () => void

  open(
    kind: string,
    options?: {
      focus?: boolean
      params?: unknown
      reason?: 'user' | 'extension' | 'activity'
    },
  ): boolean

  close(options?: {
    reason?: 'user' | 'extension'
  }): void

  toggle(kind: string): boolean

  isRegistered(kind: string): boolean

  getActiveKind(): string | null

  list(): readonly QaSurfacePanelDefinition[]
}
```

Recommended context/service name:

```ts
ctx.qaSurfacePanels
```

If DSH naming conventions in the actual target branch make another mechanism more appropriate, preserve the semantics and document the final exported name.

### 6.4 Registration lifecycle

Registration MUST happen under plugin lifecycle management.

Pseudocode:

```ts
ctx.effect(() => {
  return ctx.qaSurfacePanels.register({
    id: '@yadsh/dsh-qa-browser',
    kind: 'browser',
    title: () => t('browser'),
    icon: 'browser',
    order: 100,
    keepMounted: true,
  })
})
```

When the disposer runs:

- remove the definition;
- remove it from launchers;
- if this panel is active, close it;
- unmount its keyed body;
- do not affect the DSH Session itself.

### 6.5 Keyed body extension point

The metadata registry MUST NOT receive a React component.

Do not implement:

```ts
ctx.qaSurfacePanels.register({
  kind: 'browser',
  component: BrowserPanel,
})
```

Instead provide one keyed client UI seat, conceptually:

```text
qa.surface.panel
```

Key:

```text
<definition.id>
```

Example conceptual registration:

```ts
ctx.slots.register(
  'qa.surface.panel',
  '@yadsh/dsh-qa-browser',
  BrowserPanel,
)
```

The exact existing DSH slot registration helper/signature MUST be taken from the target branch rather than invented.

### 6.6 Owner props / panel context

The QA Surface shell provides only presentation-level information.

Proposed props:

```ts
export interface QaSurfacePanelOwnerProps {
  panelId: string
  panelKind: string

  /**
   * Active native DSH Session represented by /qa.
   * Null only while no Session is ready.
   */
  sessionId: string | null

  /**
   * Body is the active visible panel.
   */
  visible: boolean

  /**
   * Current presentation.
   */
  presentation: 'side' | 'fullscreen'

  /**
   * Navigation params from the latest open() request.
   * The extension narrows/validates its own params.
   */
  params: unknown

  /**
   * Close/reveal actions are presentation actions only.
   */
  actions: {
    close(): void
    reveal(options?: { focus?: boolean }): void
  }

  /**
   * Aborted when this panel registration/body lifetime ends.
   * It MUST NOT abort simply because the panel is hidden.
   */
  signal: AbortSignal
}
```

Feature-specific state does not belong here.

Browser tabs, logs, artifacts, traces, etc. stay owned by their plugins.

---

## 7. State model

Keep the shell state intentionally small.

Suggested state:

```ts
interface QaPanelLayoutState {
  open: boolean
  activeKind: string | null
  widthPx: number
  fullscreen: boolean
  paramsByKind: Record<string, unknown>
}
```

Implementation MAY normalize this differently, but v1 should not introduce a generic docking graph.

### 7.1 Scope

Panel presentation state is browser/client state.

It MUST NOT:

- be written to the DSH Session event log;
- appear as agent-visible state;
- affect replay;
- create a new Session when opened/closed.

### 7.2 Session switching

QA Surface currently presents one native DSH Session at a time.

Rules:

- panel registration is global to the QA Surface client;
- active/open presentation state may be global to the mounted QA Surface;
- the panel body receives the current `sessionId`;
- extensions decide whether their feature state is per Session.

For Browser, Browser state will be per Session in the Browser plugin, not in QA Surface.

### 7.3 Persistence

MVP:

- no persistence of active panel;
- no persistence of panel navigation params;
- width MAY be kept only for the lifetime of the page.

Optional follow-up:

- persist preferred width in a QA Surface UI preference;
- never persist extension-owned feature data here.

---

## 8. Layout behavior

### 8.1 Desktop

Default policy:

- side panel is closed on initial QA load;
- opening reserves width;
- conversation remains mounted;
- panel width is resizable;
- panel has a minimum width;
- conversation has a protected minimum width;
- if both minimums no longer fit, switch to fullscreen behavior rather than squeezing chat to unusable width.

Suggested initial constants:

```ts
const PANEL_DEFAULT_RATIO = 0.42
const PANEL_MIN_PX = 320
const CHAT_MIN_PX = 400
const PANEL_MAX_RATIO = 0.70
const MOBILE_BREAKPOINT_PX = 768
```

Treat these as implementation defaults, not public API.

### 8.2 Resize

Use a single draggable divider.

Requirements:

- pointer capture;
- no layout jump on release;
- clamp to min/max;
- no global document listeners left after unmount;
- keyboard resize is desirable but may be follow-up if current QA Surface has no equivalent accessible primitive.

### 8.3 Narrow/mobile

Below the chosen breakpoint:

- opening a panel uses fullscreen presentation;
- QA chat stays mounted behind/alongside the presentation state;
- closing returns to chat;
- do not create a second route;
- browser back SHOULD NOT be overloaded for panel close in v1 unless QA Surface already has a route-state convention.

### 8.4 Switching panels

Only one panel is active in v1.

When switching A → B:

- if A `keepMounted=false`, unmount A;
- if A `keepMounted=true`, leave A mounted but hidden/inert;
- B becomes visible;
- width/presentation stay unchanged.

Hidden kept-alive bodies MUST NOT remain keyboard focusable.

Use `inert`, appropriate visibility styles, or equivalent behavior.

---

## 9. Launcher behavior

The QA header owns the launcher.

Rules:

- no registered visible panels → render no launcher affordance;
- one or more registered visible panels → render panel entries;
- order by `order`, then title/id as deterministic tie-breaker;
- active panel entry indicates active state;
- clicking active panel MAY toggle it closed;
- extensions may also be opened by `ctx.qaSurfacePanels.open()`.

Initial presentation can be:

- direct icon buttons for a small number of panels;
- overflow/picker after a threshold.

Do not solve a complex toolbar system in this change.

### 9.1 Icon tokens

To avoid passing React values through the registry:

```ts
icon?: string
```

QA Surface resolves known tokens such as:

- `browser`;
- `artifacts`;
- `logs`;
- `activity`;
- `terminal`;
- fallback `plugin`.

Unknown tokens MUST degrade to the generic icon.

A future keyed icon slot can be added if concrete demand appears.

---

## 10. Panel header

QA Surface owns only generic chrome:

- title;
- optional active-state indicator;
- close button;
- fullscreen/back behavior when needed.

Feature-specific controls belong in the body.

For Browser, address bar, reload, viewport selector, tabs, console/network switches, etc. belong to `dsh-qa-browser`, not QA Surface.

This matches the upstream DSH principle that a type's controls should live in its own body rather than polluting generic panel chrome.

---

## 11. Programmatic reveal

A core use case:

1. panel plugin detects feature activity;
2. panel plugin calls `open(kind, { reason: 'activity', focus: false })`;
3. QA Surface reveals the panel without stealing text-input focus.

For Browser:

```ts
ctx.qaSurfacePanels.open('browser', {
  reason: 'activity',
  focus: false,
})
```

Policy:

- activity may reveal a closed panel if plugin config allows it;
- an extension MUST NOT repeatedly steal focus;
- QA Surface itself does not implement per-extension auto-open policy.

Browser owns its own setting such as:

```yaml
ui:
  autoRevealOnAgentActivity: true
```

---

## 12. Loading order and missing dependencies

### 12.1 Browser loads after QA Surface

Normal case:

- service exists;
- Browser registers panel;
- launcher updates reactively.

### 12.2 QA Surface loads after extension

Use DSH dependency/injection ordering where possible.

Do not add polling for `ctx.qaSurfacePanels`.

The Browser client package SHOULD declare/inject the QA Surface panel service so load order is explicit.

### 12.3 Extension absent

QA Surface must work exactly as before.

### 12.4 QA Surface absent

An extension that specifically targets QA Surface should:

- avoid crashing the whole DSH client;
- fail its UI registration clearly;
- optionally keep non-UI host capability active if the extension is designed for that;
- report a useful diagnostic.

---

## 13. Error behavior

Registry errors:

| Condition | Behavior |
|---|---|
| duplicate `id` | reject registration, developer-visible error |
| duplicate `kind` | reject in v1 |
| invalid/empty id | reject |
| invalid/empty kind | reject |
| body missing for registered panel | render controlled "Panel unavailable" fallback |
| `open()` unknown kind | return `false`, no crash |
| plugin unload while active | close panel cleanly |
| panel body throws | extension error boundary; do not destroy QA chat |

The shell SHOULD have an error boundary around the extension body.

The fallback must identify the panel kind/id for diagnostics without exposing internal stack traces to normal end users.

---

## 14. Styling contract

QA Surface should expose layout, not unrestricted CSS internals.

Extension body receives a rectangular content area with:

```css
width: 100%;
height: 100%;
min-width: 0;
min-height: 0;
overflow: hidden;
```

The extension owns internal scrolling.

Do not make the outer panel body an implicit vertical scroller; Browser/terminal/log panels need to own their scroll behavior.

Use existing DSH/QA theme tokens wherever possible.

Do not require an extension to import QA Surface private CSS class names.

---

## 15. Accessibility

MVP requirements:

- launcher buttons have accessible labels;
- active/pressed state is exposed;
- close button has accessible label;
- divider uses an appropriate separator role when practical;
- hidden kept-alive bodies are not focusable;
- fullscreen panel traps no focus permanently after closing;
- Escape closes fullscreen panel unless the active extension explicitly handles an inner modal first;
- focus returns to a sensible QA element after close.

---

## 16. Proposed source layout

Adapt names to the existing repository structure after the initial audit.

Suggested additions:

```text
plugins/dsh-qa-surface/
└── src/
    └── client/
        ├── panels/
        │   ├── contract.ts
        │   ├── registry.ts
        │   ├── service.ts
        │   ├── store.ts
        │   ├── PanelHost.tsx
        │   ├── PanelHeader.tsx
        │   ├── PanelLauncher.tsx
        │   ├── PanelErrorBoundary.tsx
        │   ├── PanelResizer.tsx
        │   └── index.ts
        └── ...
```

Public client exports should be intentionally narrow:

```text
@yadsh/dsh-qa-surface/client/panels
```

Export only:

- public types;
- service type/token if required;
- supported registration helpers if required.

Do not export the internal store or layout components.

---

## 17. Configuration

Keep most panel behavior built-in.

Optional QA Surface configuration:

```yaml
ui:
  panels:
    enabled: true
    defaultWidthRatio: 0.42
    minWidth: 320
    mobileBreakpoint: 768
```

Prefer not to expose every constant.

If no panel plugins are installed, enabling panel support must have no visual effect.

Potential compatibility switch:

```yaml
ui:
  panels:
    enabled: false
```

This allows fast rollback without uninstalling extension plugins.

---

## 18. Compatibility strategy

Target first:

```text
DSH 0.1.5-rc.2
```

The implementation MUST be verified against the actual branch/package API before coding begins.

The public QA panel API belongs to `@yadsh/dsh-qa-surface`, not DSH upstream.

Versioning policy recommendation:

- additive optional fields: minor;
- behavior fixes preserving contract: patch;
- rename/removal of fields or service: major/pre-1.0 documented breaking release.

Browser should declare a peer/range compatible with the first release that ships panel extensions.

Example conceptually:

```json
{
  "peerDependencies": {
    "@yadsh/dsh-qa-surface": ">=0.2.0 <0.3.0"
  }
}
```

Use the actual chosen version during implementation.

---

## 19. Testing plan

### 19.1 Registry unit tests

Cover:

- register/unregister;
- deterministic order;
- duplicate id;
- duplicate kind;
- hidden `userVisible=false`;
- unknown open;
- active panel removed;
- disposer idempotence;
- reactive launcher update.

### 19.2 Store/layout tests

Cover:

- open/close/toggle;
- switching panels;
- params update;
- width clamp;
- transition to fullscreen;
- session id changes without shell reset;
- `keepMounted`;
- hidden panel inertness.

### 19.3 Component tests

Create two fake plugins/panels:

```text
alpha
beta
```

Verify:

- launcher appears dynamically;
- body is selected by keyed id;
- panel A can remain mounted;
- panel B can unmount;
- an extension can programmatically reveal itself;
- a crashing extension is isolated by an error boundary.

### 19.4 Browser E2E

Against assembled DSH + QA Surface:

1. open `/qa`;
2. verify full-width chat with no panel extensions;
3. enable fixture extension;
4. open panel;
5. verify real width reservation;
6. drag divider;
7. switch to second panel;
8. collapse;
9. narrow viewport;
10. open panel and verify fullscreen mode;
11. close and verify chat/session stayed mounted.

### 19.5 Plugin unload/reload

If the development runtime supports dynamic unload:

- register;
- open;
- dispose plugin;
- verify launcher/body gone;
- verify QA chat remains functional.

If not, unit test disposer semantics and verify on full client reload.

---

## 20. Implementation plan

### Phase 0 — Audit current QA Surface

Before edits:

- map current client entrypoint;
- identify QA root component;
- identify header component;
- identify responsive/mobile logic;
- identify current settings source;
- identify exact DSH Slot/client-extension API used by the branch;
- identify how client services are declared/injected;
- record current tests and fixture setup.

Deliverable:

```text
docs/implementation-notes/qa-panel-extension-audit.md
```

or equivalent local working note; not necessarily shipped.

### Phase 1 — Registry and service

Implement:

- public types;
- registry;
- registration disposer;
- open/close/toggle;
- observable list/active state;
- unit tests.

No UI body yet.

### Phase 2 — Keyed panel body seat

Implement:

- `qa.surface.panel`;
- id-to-body resolution;
- owner props;
- missing-body fallback;
- error boundary;
- lifecycle signal.

Add fixture panels in tests.

### Phase 3 — Desktop shell

Implement:

- header launcher;
- right column;
- divider;
- width constraints;
- generic panel header;
- close/switch behavior.

### Phase 4 — Responsive behavior

Implement:

- fullscreen panel below breakpoint;
- same mounted QA chat;
- focus restoration;
- kept-alive hidden-body behavior.

### Phase 5 — Public exports and compatibility

Implement:

- stable client export path;
- TypeScript API test/fixture consuming the package externally;
- README section: "Panel extensions";
- compatibility matrix update;
- release notes.

### Phase 6 — Browser integration smoke

Do not implement Browser here.

Use a tiny fixture/external test plugin that:

- registers `kind: 'browser'`;
- renders placeholder text;
- auto-opens itself.

This proves another plugin can consume the contract without private imports.

---

## 21. Acceptance criteria

The change is complete only when all of the following are true:

- [ ] QA Surface builds/runs with zero panel plugins installed.
- [ ] Installing a fixture extension adds a launcher without editing QA Surface.
- [ ] The fixture body is provided through a keyed extension seat, not through a React component in the metadata registry.
- [ ] The fixture can call `open()` and reveal itself.
- [ ] Desktop panel reserves width rather than overlaying chat.
- [ ] Narrow/mobile panel uses fullscreen presentation.
- [ ] Closing/switching panels does not recreate the DSH Session.
- [ ] `keepMounted=true` preserves a panel body's local state.
- [ ] `keepMounted=false` releases it when inactive.
- [ ] Plugin disposal removes the panel cleanly.
- [ ] Extension crashes do not crash the QA chat.
- [ ] The shell contains no Browser-specific import, setting, state, copy, or dependency.
- [ ] Public extension API has an external-consumer compile test.
- [ ] DSH `0.1.5-rc.2` assembled E2E passes.

---

## 22. Explicit architectural invariants

These rules should be left as comments/tests where practical.

1. **QA Surface owns layout; extensions own feature behavior.**
2. **The panel registry stores metadata, not React implementations.**
3. **One active panel is enough until a real use case proves otherwise.**
4. **Panel presentation never enters the DSH Session log.**
5. **A hidden panel is not equivalent to a destroyed feature session.**
6. **Extension controls belong inside extension bodies.**
7. **No Browser dependency is permitted in `dsh-qa-surface`.**
8. **Do not copy the full native DSH docking engine.**
9. **Do not open a second server/port for panel extensions.**
10. **Every registration must have deterministic cleanup.**

---

## 23. Deferred ideas

Only consider after Browser is working:

- multiple simultaneous panels;
- tab strip inside QA panel host;
- panel pinning;
- per-panel width memory;
- draggable ordering;
- custom icon keyed slot;
- panel-specific header addons;
- panel popout;
- route-addressable panel state;
- persistence across page reload;
- integration bridge to native DSH rightbar;
- generalized resource routing.

---

## 24. Handoff note for coding agent

Implement the smallest contract that satisfies the acceptance criteria.

Before inventing any DSH API:

1. inspect the target branch;
2. use the actual slot/service/injection conventions already present there;
3. mirror the lifecycle discipline of upstream dynamic plugins;
4. keep public types in a narrow export;
5. avoid refactoring unrelated QA Surface code;
6. keep Browser entirely out of this PR.

The desired result is not "a browser panel".

The desired result is:

> **QA Surface becomes a small, stable extension host into which a browser panel can be installed by another plugin.**
