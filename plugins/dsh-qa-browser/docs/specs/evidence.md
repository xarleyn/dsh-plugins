# SPEC: dsh-qa-browser — Browser Evidence, Screenshots & Visual QA

**Status:** Draft  
**Target plugin:** `dsh-qa-browser`  
**Primary goal:** расширить `dsh-qa-browser` из browser automation/runtime в полноценный browser QA/evidence runtime для DeepSeek Harness.  
**Scope:** screenshots, evidence bundles, visual analysis integration, console/network capture, tracing, visual diff, failure diagnostics, artifact persistence и QA Surface.

---

## 1. Context

`dsh-qa-browser` уже решает задачу управляемого браузера для агента: открытие страниц, навигация, вкладки, получение semantic snapshot, interaction по semantic refs и отображение браузера в QA Surface.

Следующий логичный слой — не только дать агенту возможность взаимодействовать со страницей, но и позволить ему:

- видеть фактический визуальный результат;
- фиксировать доказательства состояния страницы;
- анализировать визуальные дефекты;
- сохранять результаты проверки как артефакты;
- автоматически собирать диагностику при ошибках;
- сравнивать визуальные состояния до/после;
- исследовать console/network/runtime проблемы без ручной серии tool calls.

Основной принцип архитектуры:

```text
semantic snapshot → основной primitive для навигации и interaction
screenshot / visual evidence → primitive для визуального анализа и QA
trace / console / network → primitive для диагностики
```

Screenshot не должен заменять semantic refs как основной способ управления страницей.

---

# 2. Goals

## 2.1 Primary goals

Добавить в `dsh-qa-browser` единый subsystem для browser evidence:

```text
BrowserRuntime
├── Sessions
├── Tabs
├── SemanticSnapshot
├── Interaction
│
├── Evidence
│   ├── Screenshot
│   ├── ConsoleCapture
│   ├── NetworkCapture
│   ├── TraceCapture
│   ├── ArtifactStore
│   ├── EvidenceBundle
│   └── VisualDiff
│
└── QA Surface
    ├── Browser
    ├── Console
    ├── Network
    ├── Screenshots
    ├── Evidence
    └── Trace
```

Agent должен иметь возможность:

1. Сделать screenshot текущего viewport.
2. Сделать full-page screenshot.
3. Сделать screenshot конкретного элемента.
4. Сохранить screenshot как DSH attachment/artifact.
5. Передать screenshot мультимодальной модели.
6. Создать evidence bundle.
7. Получить console errors.
8. Получить failed network requests.
9. Включить/выключить Playwright tracing.
10. Автоматически получить evidence при падении browser action.
11. Сравнить два screenshot или screenshot с baseline.
12. Просматривать evidence в QA Surface.
13. Сохранять evidence в workspace при необходимости.

---

# 3. Non-goals

В первую очередь НЕ требуется:

- превращать браузер в полностью screenshot-driven computer-use;
- заменять semantic refs координатными кликами;
- реализовывать собственную vision model;
- хранить каждый browser frame как постоянный artifact;
- писать собственный tracing engine вместо Playwright;
- делать полноценный аналог Chrome DevTools;
- поддерживать все Chrome DevTools Protocol domains в первой версии;
- автоматически загружать чувствительные screenshots во внешние сервисы;
- сохранять browser credentials/session secrets в evidence artifacts.

---

# 4. Design principles

## 4.1 Semantic-first interaction

Основной цикл остаётся:

```text
snapshot
  ↓
semantic refs
  ↓
click / fill / type / select / hover
```

Visual workflow используется отдельно:

```text
screenshot
  ↓
vision/model analysis
  ↓
decision
```

Это уменьшает:

- расход multimodal tokens;
- вероятность ошибочных coordinate-based interactions;
- зависимость от resolution;
- хрупкость automation.

---

## 4.2 Evidence is first-class

Screenshot не должен быть просто временным base64 внутри tool result.

Любой важный capture должен иметь нормальную идентичность:

```ts
interface EvidenceArtifact {
  id: string;
  type: EvidenceType;
  mimeType: string;

  sessionId: string;
  tabId: string;

  url: string;
  title?: string;

  revision?: number;

  createdAt: string;

  attachmentId?: string;
  workspacePath?: string;

  byteSize: number;
  sha256: string;

  metadata: Record<string, unknown>;
}
```

---

## 4.3 Bounded tool results

Большие изображения, trace zip, HAR, response body и прочие бинарные данные нельзя возвращать непосредственно в model context.

Tool result должен содержать:

```text
metadata
preview
attachment/artifact reference
```

а не мегабайты base64.

---

## 4.4 Opt-in persistence

По умолчанию временные QA captures могут жить как DSH attachment/runtime artifact.

Явное сохранение в workspace должно быть отдельным режимом.

---

# 5. Proposed user-facing tools

---

## 5.1 `browser_screenshot`

Расширить существующий tool.

### Request

```ts
interface BrowserScreenshotRequest {
  tabId?: string;

  capture?: "viewport" | "fullPage" | "element" | "clip";

  ref?: string;

  clip?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  format?: "png" | "jpeg";
  quality?: number;

  scale?: "css" | "device";

  maskRefs?: string[];

  animations?: "allow" | "disabled";

  caret?: "hide" | "initial";

  save?: "attachment" | "workspace" | "both";

  name?: string;

  reason?: string;
}
```

### Defaults

```yaml
capture: viewport
format: png
scale: css
animations: disabled
caret: hide
save: attachment
```

### Response

```ts
interface BrowserScreenshotResult {
  success: true;

  sessionId: string;
  tabId: string;

  url: string;
  title?: string;
  revision?: number;

  screenshot: {
    artifactId: string;
    attachmentId?: string;
    workspacePath?: string;

    mimeType: string;
    width: number;
    height: number;
    byteSize: number;
    sha256: string;
  };
}
```

---

# 6. Screenshot capture modes

## 6.1 Viewport

```text
capture = viewport
```

Captures only visible viewport.

Use cases:

- quick visual check;
- modal inspection;
- responsive state;
- current user-visible state.

---

## 6.2 Full page

```text
capture = fullPage
```

Use cases:

- page QA;
- landing pages;
- documentation;
- comparison with reference;
- complete evidence.

Potential issue:

Very long pages can generate huge images.

Add limits:

```yaml
screenshots:
  maxWidth: 5000
  maxHeight: 30000
  maxPixels: 80000000
```

If limit exceeded:

- return explicit error;
- or optionally fall back to tiled capture in future.

---

## 6.3 Element

```text
capture = element
ref = e42
```

Resolve element from current semantic snapshot/ref map.

Before capture:

1. validate ref belongs to current revision;
2. ensure element still exists;
3. optionally scroll into view;
4. capture locator screenshot.

Useful for:

- buttons;
- cards;
- dialogs;
- charts;
- specific broken components.

---

## 6.4 Clip

Lower-level mode.

```ts
clip: {
  x,
  y,
  width,
  height
}
```

Should not normally be used by model unless needed for debugging.

---

# 7. Screenshot masking

Screenshots can unintentionally include:

- passwords;
- tokens;
- email;
- usernames;
- customer data;
- financial information;
- internal dashboards.

Support explicit masking:

```ts
maskRefs?: string[]
```

Possible future extension:

```ts
maskSelectors?: string[]
```

Do not expose raw selectors unless plugin already intentionally supports selector-based operations.

Optional automatic policies:

```yaml
evidence:
  autoMask:
    passwordInputs: true
    autocompleteSensitiveFields: true
```

---

# 8. DSH attachment integration

Preferred default:

```text
Playwright screenshot Buffer
        ↓
EvidenceArtifact
        ↓
DSH attachment
        ↓
tool result references attachment
```

Do not require writing screenshot to workspace first.

Benefits:

- less filesystem pollution;
- easier multimodal delivery;
- works naturally with chat;
- can later persist explicitly.

---

# 9. Multimodal model integration

The browser plugin should not depend on a specific model provider.

Instead it produces an image artifact that DSH can expose as an image content block when supported.

Desired logical flow:

```text
browser_screenshot
    ↓
attachment
    ↓
DSH model adapter
    ↓
image content block
    ↓
multimodal model
```

For text-only models:

```text
browser_screenshot
    ↓
attachment
    ↓
separate vision/image analysis tool
    ↓
text analysis
```

The browser plugin MUST NOT embed provider-specific vision API calls in the core Evidence subsystem.

---

# 10. Evidence Bundle

Introduce high-level tool:

```text
browser_capture_evidence
```

This should be the main QA/debugging primitive.

### Example

```ts
browser_capture_evidence({
  reason: "Checkout button overlaps payment form",
  screenshot: {
    capture: "viewport"
  },
  snapshot: true,
  console: "errors",
  network: "failed",
  trace: false
})
```

---

## 10.1 Request schema

```ts
interface CaptureEvidenceRequest {
  tabId?: string;

  reason?: string;

  screenshot?:
    | boolean
    | BrowserScreenshotRequest;

  snapshot?: boolean;

  console?:
    | false
    | "errors"
    | "warnings"
    | "all";

  network?:
    | false
    | "failed"
    | "errors"
    | "all";

  includeRecentActions?: boolean;

  trace?:
    | false
    | "stop-and-attach"
    | "snapshot";

  save?: "attachment" | "workspace" | "both";

  name?: string;
}
```

---

## 10.2 Result

```ts
interface EvidenceBundleResult {
  bundleId: string;

  sessionId: string;
  tabId: string;

  url: string;
  title?: string;

  revision?: number;

  reason?: string;
  createdAt: string;

  artifacts: EvidenceArtifactSummary[];

  summary: {
    consoleErrors: number;
    failedRequests: number;
    warnings: number;
  };
}
```

---

# 11. Artifact bundle structure

When persisted to workspace:

```text
artifacts/
└── browser/
    └── 2026-09-19T07-42-18-checkout/
        ├── metadata.json
        ├── screenshot.png
        ├── snapshot.json
        ├── console.json
        ├── network.json
        ├── actions.json
        └── trace.zip
```

Not every file must exist.

---

# 12. `metadata.json`

Example:

```json
{
  "schemaVersion": 1,
  "bundleId": "ev_01J...",
  "sessionId": "bs_...",
  "tabId": "tab_...",
  "url": "https://app.example.com/checkout",
  "title": "Checkout",
  "revision": 42,
  "viewport": {
    "width": 1440,
    "height": 900,
    "deviceScaleFactor": 1
  },
  "reason": "Checkout button overlaps payment form",
  "createdAt": "2026-09-19T07:42:18.000Z"
}
```

---

# 13. Console capture

Add runtime console ring buffer per tab/page.

Capture:

```ts
interface ConsoleEntry {
  id: string;
  timestamp: string;

  type:
    | "log"
    | "debug"
    | "info"
    | "warning"
    | "error";

  text: string;

  location?: {
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
  };

  argsPreview?: unknown[];
}
```

---

## 13.1 `browser_console`

Tool:

```ts
browser_console({
  tabId?,
  level?: "errors" | "warnings" | "all",
  since?: "lastAction" | "navigation" | number,
  limit?: number
})
```

Defaults:

```yaml
level: errors
limit: 100
```

Do not return unlimited logs.

---

# 14. JavaScript page errors

Console errors and uncaught exceptions should be distinguished.

Capture:

```text
page.on("pageerror")
```

Represent as:

```ts
interface PageErrorEntry {
  timestamp: string;
  name?: string;
  message: string;
  stack?: string;
}
```

Stacks should be bounded/truncated.

---

# 15. Network capture

Maintain bounded request history.

Capture metadata:

```ts
interface NetworkEntry {
  id: string;

  startedAt: string;
  completedAt?: string;

  method: string;
  url: string;

  resourceType?: string;

  status?: number;
  statusText?: string;

  failed?: boolean;
  failureText?: string;

  durationMs?: number;

  requestHeadersPreview?: Record<string, string>;
  responseHeadersPreview?: Record<string, string>;
}
```

Secrets MUST be redacted from headers.

Default redactions:

```text
Authorization
Proxy-Authorization
Cookie
Set-Cookie
X-API-Key
X-Auth-Token
```

Configurable extension allowed.

---

# 16. `browser_network`

```ts
browser_network({
  tabId?,
  filter?: "failed" | "errors" | "all",
  since?: "lastAction" | "navigation" | number,
  limit?: number,
  includeHeaders?: boolean
})
```

Do not return response bodies by default.

---

# 17. Optional response body capture

Future/advanced feature:

```ts
browser_network_body({
  requestId,
  maxBytes?
})
```

Must be opt-in.

Important constraints:

- body can contain secrets;
- body can be huge;
- body can be binary;
- body should become attachment when large.

Config:

```yaml
network:
  allowBodyCapture: false
  maxBodyBytes: 1048576
```

Default: disabled.

---

# 18. Playwright tracing

Add trace lifecycle tools:

```text
browser_trace_start
browser_trace_stop
```

---

## 18.1 Start

```ts
browser_trace_start({
  screenshots?: true,
  snapshots?: true,
  sources?: false,
  name?: string
})
```

Default:

```yaml
screenshots: true
snapshots: true
sources: false
```

Sources should default to false because project source may be sensitive and can heavily increase trace size.

---

## 18.2 Stop

```ts
browser_trace_stop({
  save?: "attachment" | "workspace" | "both",
  name?: string
})
```

Result:

```ts
{
  artifactId,
  attachmentId?,
  workspacePath?,
  byteSize,
  sha256
}
```

---

# 19. Trace lifecycle safety

Only one active Playwright trace per BrowserContext unless implementation explicitly supports grouping.

State:

```ts
interface TraceState {
  active: boolean;
  startedAt?: string;
  name?: string;
}
```

If a second start is requested:

```text
TRACE_ALREADY_ACTIVE
```

If stop without start:

```text
TRACE_NOT_ACTIVE
```

---

# 20. Automatic evidence on failure

This should be one of the primary features.

When a browser action fails:

```text
browser_click
browser_fill
browser_type
browser_select
browser_hover
browser_wait
browser_assert*
...
```

the runtime can automatically collect bounded evidence.

Example:

```text
browser_click(ref=e19)
    ↓
Playwright timeout
    ↓
AutoEvidenceCollector
    ├── viewport screenshot
    ├── semantic snapshot
    ├── console errors
    ├── failed network requests
    └── recent actions
    ↓
tool error contains evidenceBundleId
```

---

## 20.1 Error result

```ts
{
  success: false,

  error: {
    code: "ACTION_TIMEOUT",
    message: "...",

    evidenceBundleId: "ev_...",
    artifacts: [
      {
        type: "screenshot",
        attachmentId: "..."
      }
    ]
  }
}
```

---

# 21. Failure capture configuration

```yaml
evidence:
  onFailure:
    enabled: true

    screenshot: true
    snapshot: true

    console: errors
    network: failed

    recentActions: 10

    trace: false
```

Tracing should NOT automatically be enabled for all sessions by default because of overhead.

---

# 22. Recent action history

Keep ring buffer:

```ts
interface BrowserActionRecord {
  id: string;
  timestamp: string;
  tool: string;

  tabId: string;

  inputPreview: unknown;

  success: boolean;
  durationMs: number;

  resultingRevision?: number;
}
```

Sensitive text must be redacted.

Example:

```text
fill(passwordRef, "***")
```

not actual password.

---

# 23. Visual comparison

Introduce:

```text
browser_visual_compare
```

Initial implementation can be pixel-based.

---

## 23.1 Inputs

```ts
interface BrowserVisualCompareRequest {
  actual:
    | { artifactId: string }
    | { captureCurrent: BrowserScreenshotRequest };

  expected:
    | { artifactId: string }
    | { workspacePath: string };

  threshold?: number;

  saveDiff?: boolean;
}
```

---

## 23.2 Output

```ts
interface BrowserVisualCompareResult {
  same: boolean;

  metrics: {
    differingPixels: number;
    differingRatio: number;
    width: number;
    height: number;
  };

  diffArtifactId?: string;
  diffAttachmentId?: string;
}
```

Avoid returning a subjective "looks good".

Return measurable facts.

---

# 24. Baseline screenshots

Optional later extension:

```text
browser_visual_baseline_save
browser_visual_baseline_compare
```

Storage:

```text
.dsh/
└── qa-browser/
    └── baselines/
        └── checkout/
            ├── desktop-chromium.png
            └── metadata.json
```

Baseline identity should include:

- browser engine;
- viewport;
- device scale;
- optional platform;
- optional theme;
- optional locale.

Otherwise false positives will be common.

---

# 25. Visual stability controls

Before visual comparison, optional helper:

```text
browser_prepare_visual_capture
```

Possible operations:

- disable animations;
- hide caret;
- wait for fonts;
- wait for images;
- wait for network idle with bounded timeout;
- optional freeze Date;
- optional deterministic reduced-motion.

Do NOT mutate application state aggressively by default.

---

# 26. Screenshot-driven fallback

Optional advanced mode.

Useful for:

- canvas;
- WebGL;
- remote desktops;
- maps;
- virtualized unusual UI;
- elements invisible to accessibility tree.

Potential tools:

```text
browser_mouse_click
browser_mouse_move
browser_mouse_drag
browser_mouse_wheel
```

Coordinate-based interaction should remain clearly marked as fallback.

Preferred priority:

```text
semantic ref
    ↓ unavailable
role/text locator
    ↓ unavailable
coordinate fallback
```

---

# 27. PDF capture

Optional tool:

```text
browser_pdf
```

Only where supported by browser/runtime.

Request:

```ts
browser_pdf({
  tabId?,
  format?: "A4" | "Letter",
  landscape?: boolean,
  printBackground?: boolean,
  save?: "attachment" | "workspace" | "both"
})
```

Useful for:

- report evidence;
- invoices;
- printable state;
- documentation.

Not required for MVP.

---

# 28. Video recording

Possible but lower priority than tracing.

Config:

```yaml
recording:
  video:
    enabled: false
```

Reason:

Playwright trace is usually more useful for agent debugging because it includes:

- screenshots;
- action timeline;
- DOM snapshots;
- network;
- console context.

Video can be Phase 4+.

---

# 29. HAR support

Optional advanced functionality:

```text
browser_har_start
browser_har_stop
```

Potential use cases:

- reproducible network investigations;
- API regression;
- offline replay.

But HAR may contain:

- auth headers;
- cookies;
- request bodies;
- customer data.

Therefore HAR must be explicitly opt-in and pass through redaction.

---

# 30. Chrome DevTools Protocol extension layer

For Chromium-only advanced features:

```ts
const cdp = await context.newCDPSession(page);
```

Do NOT leak raw CDP to ordinary agents initially.

Instead wrap useful operations behind safe high-level tools.

Possible future modules:

```text
PerformanceEvidence
CoverageEvidence
HeapEvidence
Screencast
RuntimeDiagnostics
```

---

# 31. Live screencast

QA Surface currently can use periodic screenshots.

Future optimization:

```text
CDP Page.startScreencast
        ↓
bounded JPEG frames
        ↓
QA Surface
```

Advantages:

- lower latency;
- smoother live preview;
- avoids repeatedly calling screenshot.

Concerns:

- Chromium-only;
- backpressure;
- frame rate;
- CPU/network;
- session cleanup.

This should be optional and should not replace screenshot artifacts.

---

# 32. Evidence Artifact Store

Introduce abstraction:

```ts
interface EvidenceStore {
  save(
    input: EvidenceSaveInput
  ): Promise<EvidenceArtifact>;

  get(
    artifactId: string
  ): Promise<EvidenceArtifact | null>;

  delete(
    artifactId: string
  ): Promise<void>;

  cleanup(): Promise<void>;
}
```

Backends:

```text
AttachmentEvidenceStore
WorkspaceEvidenceStore
CompositeEvidenceStore
```

---

# 33. Runtime artifact storage

For temporary artifacts:

```text
$DSH_HOME/
└── cache/
    └── dsh-qa-browser/
        └── evidence/
```

Do not hardcode home paths.

Always derive from DSH runtime/config/environment.

Potential environment variable:

```text
DSH_HOME
```

Persistent user artifacts should preferably go to workspace or DSH attachment storage instead.

---

# 34. Retention

Temporary evidence needs cleanup.

Example config:

```yaml
evidence:
  retention:
    tempMaxAgeHours: 24
    maxTotalBytes: 1073741824
    maxArtifacts: 1000
```

Cleanup:

- at plugin startup;
- periodically;
- when limits exceeded.

Never delete explicitly persisted workspace artifacts.

---

# 35. Deduplication

Optional but useful:

```text
SHA-256
```

If identical screenshot is captured repeatedly:

```text
same bytes → reuse blob / artifact payload
```

Metadata entries may remain separate.

This integrates naturally with content-addressed artifact ideas later.

---

# 36. QA Surface UI

Add tabs/panels.

Suggested UI:

```text
┌───────────────────────────────────────────────┐
│ Browser | Console | Network | Evidence | Trace│
├───────────────────────────────────────────────┤
│                                               │
│                  CONTENT                      │
│                                               │
└───────────────────────────────────────────────┘
```

---

# 37. Screenshots / Evidence panel

Evidence panel should show:

```text
[07:42:18] Screenshot
Checkout button overlaps payment form
Viewport 1440×900
Open | Save | Compare

[07:42:21] Auto-captured failure
browser_click timeout
Screenshot · Snapshot · 2 console errors · 1 failed request
Open bundle
```

---

# 38. Evidence detail view

Display:

- image preview;
- URL;
- page title;
- timestamp;
- tab;
- revision;
- viewport;
- reason;
- associated tool/action;
- console errors;
- network failures;
- download/open attachment controls;
- save-to-workspace;
- compare.

---

# 39. Console panel

Features:

- level filter;
- search;
- clear;
- auto-scroll;
- source location;
- count badges.

Avoid rendering unlimited history.

Configurable max:

```yaml
console:
  maxEntriesPerTab: 1000
```

---

# 40. Network panel

Initial columns:

```text
Method
Status
Type
URL
Duration
```

Filters:

```text
All
Failed
4xx/5xx
Fetch/XHR
Document
JS
CSS
Image
```

Detailed response body viewer is not MVP.

---

# 41. Trace panel

States:

```text
Trace inactive
[Start trace]
```

or:

```text
Recording trace
00:01:42
[Stop and attach]
```

After capture:

```text
trace.zip
Open in Trace Viewer
Save to workspace
```

If embedding Trace Viewer is too invasive, first version can expose artifact/download/open-external action.

---

# 42. Model-facing tool naming

Keep tool surface small.

Recommended core tools:

```text
browser_screenshot
browser_capture_evidence
browser_console
browser_network
browser_trace_start
browser_trace_stop
browser_visual_compare
```

Avoid separate tools for every tiny evidence operation.

---

# 43. Tool descriptions

Tool descriptions must clearly guide agent behavior.

Example:

### `browser_screenshot`

> Capture the visual state of the current browser page. Use for layout, rendering, canvas, chart, modal, responsive and other visual checks. Prefer semantic snapshot tools for normal navigation and element interaction.

### `browser_capture_evidence`

> Capture a diagnostic bundle for the current page, optionally including screenshot, semantic snapshot, console errors, failed network requests and trace data. Use when investigating failures or preserving QA evidence.

---

# 44. Revision semantics

Screenshots should be associated with current page revision where possible.

Example:

```ts
{
  revision: 42
}
```

If page changes after screenshot:

```text
screenshot still remains valid evidence of revision 42
```

Element screenshot refs must validate their originating revision.

Do not silently reuse stale semantic refs.

---

# 45. Navigation boundaries

On navigation:

- reset page-local semantic refs;
- preserve previous evidence;
- mark network navigation boundary;
- update action history;
- optionally start new console/network logical segment.

This allows queries:

```text
console since navigation
network since navigation
```

---

# 46. Multi-tab behavior

All evidence must have:

```text
sessionId
tabId
```

Never rely purely on "active tab" once artifact exists.

If agent does not specify `tabId`, resolve active tab at tool invocation and write the concrete ID into result.

---

# 47. Popup handling

When popup/new tab appears:

- register new tab;
- assign tab ID;
- start console/network buffers automatically;
- allow screenshot immediately;
- show in QA Surface.

---

# 48. Browser session cleanup

On session close:

- stop active trace safely;
- finalize or discard temp buffers;
- detach listeners;
- remove CDP sessions;
- clean temporary files;
- preserve persisted artifacts.

Avoid leaking Playwright event handlers.

---

# 49. Configuration

Example:

```yaml
- id: dsh-qa-browser
  config:
    evidence:
      enabled: true

      screenshots:
        format: png
        scale: css
        animations: disabled

        maxWidth: 5000
        maxHeight: 30000
        maxPixels: 80000000

      onFailure:
        enabled: true
        screenshot: true
        snapshot: true
        console: errors
        network: failed
        recentActions: 10
        trace: false

      retention:
        tempMaxAgeHours: 24
        maxTotalBytes: 1073741824
        maxArtifacts: 1000

      redaction:
        headers:
          - authorization
          - proxy-authorization
          - cookie
          - set-cookie
          - x-api-key
          - x-auth-token

        passwordInputs: true

    console:
      maxEntriesPerTab: 1000

    network:
      maxEntriesPerTab: 2000
      allowBodyCapture: false
      maxBodyBytes: 1048576

    trace:
      includeSources: false

    visualDiff:
      enabled: true
      defaultThreshold: 0.01
```

---

# 50. Config validation

At startup:

- validate numeric limits;
- clamp dangerous values;
- reject invalid format;
- normalize header names;
- log effective evidence configuration.

Example:

```text
maxPixels <= 200,000,000
maxEntriesPerTab <= 10,000
maxBodyBytes <= configured hard cap
```

Hard safety limits can exist independently of user config.

---

# 51. Security

Evidence can be more sensitive than normal browser automation.

Threats:

1. secrets visible on screen;
2. passwords in forms;
3. session cookies in headers;
4. Authorization headers;
5. sensitive request/response bodies;
6. internal URLs;
7. PII in screenshots;
8. traces containing DOM text;
9. HAR containing tokens;
10. project source included in trace.

Defaults must therefore be conservative.

---

# 52. Redaction pipeline

Introduce:

```ts
interface EvidenceRedactor {
  redactConsole(entry): ConsoleEntry;
  redactNetwork(entry): NetworkEntry;
  redactAction(action): BrowserActionRecord;
  getScreenshotMasks(page): Promise<MaskTarget[]>;
}
```

Redaction happens before persistence where possible.

---

# 53. Screenshot secret masking

Automatic masking candidates:

```text
input[type=password]
autocomplete=current-password
autocomplete=new-password
```

Potential future masks:

```text
[data-sensitive]
[data-private]
```

Provide configuration:

```yaml
evidence:
  redaction:
    selectors:
      - "[data-sensitive]"
```

Only if exposing CSS selector config is acceptable.

---

# 54. Network redaction

Header keys case-insensitive.

Example:

```json
{
  "authorization": "<redacted>",
  "cookie": "<redacted>"
}
```

URL query strings MAY also contain tokens.

Optional configurable query params:

```yaml
redaction:
  queryParams:
    - token
    - access_token
    - api_key
    - key
    - signature
```

---

# 55. Artifact naming

Use safe deterministic-ish naming:

```text
2026-09-19T07-42-18_checkout_ev-abc123
```

Sanitize:

- slashes;
- control chars;
- path traversal;
- excessively long names.

Never allow arbitrary `../../`.

---

# 56. Performance

Screenshots and tracing can be expensive.

Need metrics:

```text
screenshot_capture_duration_ms
screenshot_bytes
evidence_bundle_duration_ms
evidence_bundle_bytes
trace_bytes
visual_diff_duration_ms
console_buffer_size
network_buffer_size
```

If plugin already has OTel integration, emit spans/metrics there.

---

# 57. Memory management

Console/network buffers must be bounded ring buffers.

Never accumulate indefinitely.

Example:

```text
console: 1000 entries/tab
network: 2000 entries/tab
actions: 100 entries/session
```

Large strings should be truncated.

Example:

```yaml
maxConsoleMessageChars: 16000
maxUrlChars: 8192
maxHeaderValueChars: 4096
```

---

# 58. Concurrency

Screenshot calls can overlap.

Use per-page capture mutex if needed to prevent unstable modifications such as:

- temporary animation disabling;
- masking;
- UI overlays;
- viewport changes.

Evidence capture should not hold global browser lock longer than necessary.

---

# 59. Artifact API abstraction

Do not wire screenshot code directly to UI.

Flow:

```text
ScreenshotService
    ↓
EvidenceStore
    ↓
event
    ├── DSH attachment
    └── QA Surface
```

This keeps browser backend usable without QA Surface.

---

# 60. Events

Suggested internal events:

```text
evidence:created
evidence:deleted
evidence:bundle-created
trace:started
trace:stopped
console:entry
network:request
network:response
network:failed
browser:action
browser:action-failed
```

---

# 61. Suggested TypeScript modules

```text
src/
├── browser/
│   ├── BrowserRuntime.ts
│   ├── BrowserSession.ts
│   ├── BrowserTab.ts
│   └── refs/
│
├── evidence/
│   ├── EvidenceManager.ts
│   ├── EvidenceStore.ts
│   ├── EvidenceTypes.ts
│   │
│   ├── screenshot/
│   │   ├── ScreenshotService.ts
│   │   ├── ScreenshotLimits.ts
│   │   └── ScreenshotMasker.ts
│   │
│   ├── console/
│   │   ├── ConsoleCapture.ts
│   │   └── ConsoleBuffer.ts
│   │
│   ├── network/
│   │   ├── NetworkCapture.ts
│   │   ├── NetworkBuffer.ts
│   │   └── NetworkRedactor.ts
│   │
│   ├── trace/
│   │   └── TraceManager.ts
│   │
│   ├── diff/
│   │   ├── VisualDiffService.ts
│   │   └── BaselineStore.ts
│   │
│   ├── bundle/
│   │   └── EvidenceBundleService.ts
│   │
│   └── redaction/
│       └── EvidenceRedactor.ts
│
├── tools/
│   ├── browserScreenshot.ts
│   ├── browserCaptureEvidence.ts
│   ├── browserConsole.ts
│   ├── browserNetwork.ts
│   ├── browserTraceStart.ts
│   ├── browserTraceStop.ts
│   └── browserVisualCompare.ts
│
├── ui/
│   └── qa-surface/
│       ├── EvidencePanel.tsx
│       ├── ConsolePanel.tsx
│       ├── NetworkPanel.tsx
│       └── TracePanel.tsx
│
└── config/
    └── evidenceConfig.ts
```

Adapt to existing repository structure rather than forcing these paths literally.

---

# 62. Error taxonomy

Suggested codes:

```text
SCREENSHOT_TOO_LARGE
SCREENSHOT_ELEMENT_NOT_FOUND
SCREENSHOT_STALE_REF
INVALID_SCREENSHOT_CLIP

EVIDENCE_STORAGE_FAILED
EVIDENCE_LIMIT_EXCEEDED

TRACE_ALREADY_ACTIVE
TRACE_NOT_ACTIVE
TRACE_SAVE_FAILED

VISUAL_DIFF_SIZE_MISMATCH
VISUAL_DIFF_FAILED

NETWORK_ENTRY_NOT_FOUND

ARTIFACT_NOT_FOUND
ARTIFACT_PERMISSION_DENIED
```

Tool results should expose stable error codes.

---

# 63. Screenshot error behavior

If screenshot fails because element is detached:

Do NOT silently capture viewport instead.

Return:

```text
SCREENSHOT_ELEMENT_NOT_FOUND
```

Agent can re-snapshot and retry.

---

# 64. Evidence capture failure semantics

Evidence collection must never hide the original browser error.

Example:

```text
Original:
browser_click timeout

Evidence:
screenshot capture failed because page crashed
```

Result must preserve:

```text
primary error = click timeout
secondary diagnostics error = screenshot capture failed
```

---

# 65. Page crash behavior

On page crash:

capture what is still available:

- recent console;
- recent network;
- recent actions;
- last successful screenshot if cached;
- page crash metadata.

Do not claim screenshot reflects crash state if it predates crash.

---

# 66. Testing strategy

## 66.1 Unit tests

Test:

- config validation;
- redaction;
- artifact naming;
- screenshot limit calculation;
- ring buffers;
- visual diff metrics;
- metadata serialization;
- retention cleanup.

---

## 66.2 Integration tests

With Playwright test pages.

Cases:

1. viewport screenshot;
2. full-page screenshot;
3. element screenshot;
4. stale ref rejection;
5. masking password field;
6. console error capture;
7. pageerror capture;
8. failed request capture;
9. trace start/stop;
10. evidence bundle creation;
11. auto evidence on failed click;
12. multi-tab evidence;
13. session close cleanup;
14. visual comparison.

---

## 66.3 Security tests

Verify:

```text
Authorization header → redacted
Cookie → redacted
password fill action → redacted
password field screenshot → masked
../ artifact name → sanitized
huge screenshot → rejected
huge console line → truncated
```

---

## 66.4 UI tests

QA Surface:

- evidence appears without reload;
- preview opens;
- filter works;
- failed action links to evidence;
- switching tabs does not mix evidence;
- trace controls reflect runtime state.

---

# 67. Fixture pages

Add deterministic test fixtures:

```text
fixtures/
├── visual-basic.html
├── long-page.html
├── console-errors.html
├── failed-network.html
├── password-form.html
├── popup.html
├── canvas.html
└── animation.html
```

Avoid depending on external websites for tests.

---

# 68. Visual test determinism

For visual diff integration tests:

- fixed viewport;
- bundled fonts;
- no transitions;
- no random data;
- no current timestamps;
- same browser build.

Do not assert pixel identity across arbitrary OS/browser versions unless environment is pinned.

---

# 69. Backward compatibility

Existing `browser_screenshot` behavior should remain compatible where possible.

If current schema is simpler:

```text
browser_screenshot()
```

must continue to work.

New parameters should be optional.

Existing attachment result fields should not be removed without migration.

---

# 70. Feature flags

During rollout:

```yaml
features:
  evidenceBundles: true
  autoEvidenceOnFailure: true
  visualDiff: false
  cdpScreencast: false
```

Allows incremental shipping.

---

# 71. Implementation phases

---

## Phase 1 — Screenshot foundation

### Scope

- formalize `EvidenceArtifact`;
- expand `browser_screenshot`;
- viewport capture;
- fullPage capture;
- element capture by semantic ref;
- attachment persistence;
- optional workspace persistence;
- SHA-256;
- metadata;
- size limits;
- screenshot masking;
- QA Surface screenshot/evidence list.

### Acceptance criteria

Agent can:

```text
open page
→ screenshot
→ receive attachment
→ model can inspect image when multimodal support exists
→ persist screenshot to workspace
```

No large base64 returned in text tool result.

---

# 72. Phase 2 — Diagnostics evidence

### Scope

- console capture;
- pageerror capture;
- network metadata capture;
- `browser_console`;
- `browser_network`;
- action history;
- redaction;
- `browser_capture_evidence`;
- Evidence panel detail view.

### Acceptance criteria

One tool call can generate:

```text
screenshot
snapshot
console errors
failed requests
recent actions
```

as a coherent bundle.

---

# 73. Phase 3 — Automatic evidence on failure

### Scope

- hook action failures;
- automatic bounded capture;
- evidenceBundleId in errors;
- QA Surface link from failure;
- configurable policies.

### Acceptance criteria

When `browser_click` times out, agent automatically receives a reference to evidence without needing additional diagnostic calls.

---

# 74. Phase 4 — Trace integration

### Scope

- trace lifecycle manager;
- `browser_trace_start`;
- `browser_trace_stop`;
- trace attachments;
- trace status in QA Surface;
- cleanup and lifecycle safety.

### Acceptance criteria

Agent can explicitly record a problematic browser interaction and save a Playwright trace artifact.

---

# 75. Phase 5 — Visual diff

### Scope

- pixel diff;
- screenshot artifact comparison;
- diff image;
- baseline storage;
- baseline metadata;
- environment identity.

### Acceptance criteria

Agent can compare:

```text
before vs after
current vs baseline
```

and receive objective diff metrics plus image artifact.

---

# 76. Phase 6 — Advanced browser QA

Optional:

- PDF;
- HAR;
- response bodies;
- video;
- coordinate fallback;
- CDP performance metrics;
- live CDP screencast;
- coverage;
- advanced visual baselines.

Do not block earlier phases on these features.

---

# 77. Suggested MVP

If implementing incrementally, MVP should be:

```text
browser_screenshot
browser_capture_evidence
console errors
failed requests
auto evidence on failure
QA Surface evidence panel
```

Tracing can follow immediately after.

Visual diff should be a separate follow-up because deterministic comparison introduces its own complexity.

---

# 78. Agent workflow examples

## Visual bug investigation

```text
1. browser_snapshot
2. browser_click(...)
3. browser_screenshot
4. model inspects image
5. modify code
6. reload
7. browser_screenshot
8. browser_visual_compare
```

---

## Runtime failure

```text
1. browser_click(...)
2. action fails
3. automatic evidence bundle generated
4. agent reads:
   - screenshot
   - console errors
   - failed requests
5. fixes issue
6. retries
```

---

## Complex flaky behavior

```text
1. browser_trace_start
2. reproduce issue
3. browser_capture_evidence
4. browser_trace_stop
5. inspect artifact
```

---

# 79. Observability

If DSH plugin infrastructure exposes metrics/tracing, emit:

```text
dsh.qa_browser.screenshot.count
dsh.qa_browser.screenshot.duration
dsh.qa_browser.screenshot.bytes

dsh.qa_browser.evidence.bundle.count
dsh.qa_browser.evidence.bundle.duration

dsh.qa_browser.console.errors
dsh.qa_browser.network.failed

dsh.qa_browser.trace.bytes

dsh.qa_browser.visual_diff.duration
```

Useful dimensions:

```text
browser_engine
capture_mode
success
failure_code
```

Avoid dimensions containing full URL due cardinality/privacy.

---

# 80. Documentation

Add user-facing docs:

```text
docs/
├── evidence.md
├── screenshots.md
├── tracing.md
├── visual-diff.md
└── security-and-redaction.md
```

README should include short examples.

---

# 81. Tool documentation examples

Example:

```text
"Take a full-page screenshot and save it as an artifact."

browser_screenshot({
  capture: "fullPage",
  save: "attachment",
  reason: "Final landing-page QA"
})
```

Example:

```text
"Collect evidence for the broken checkout."

browser_capture_evidence({
  reason: "Checkout regression",
  screenshot: true,
  snapshot: true,
  console: "errors",
  network: "failed"
})
```

---

# 82. Migration / versioning

Evidence metadata needs schema version.

```json
{
  "schemaVersion": 1
}
```

Do not rely on filename format as schema.

Future versions can migrate readers while keeping old artifacts readable.

---

# 83. Open questions for implementation

These should be answered against current `dsh-qa-browser` code before coding:

1. How exactly are current screenshot attachments created?
2. Does DSH tool result schema already support image content blocks directly?
3. Does QA Surface receive screenshot bytes through plugin events, HTTP endpoints or shared runtime state?
4. Is semantic `revision` already available in a stable API?
5. Are refs currently page-local or session-global?
6. Is there already a generic DSH artifact abstraction that should be reused?
7. Is `$DSH_HOME` exposed to plugins directly?
8. Does DSH expose lifecycle hooks for session cleanup?
9. Is there an existing plugin event bus suitable for evidence events?
10. Is current browser implementation Chromium-only or multi-engine?
11. Is Playwright Context persistent or recreated per browser session?
12. Can attachment IDs be resolved to image input automatically by the selected model adapter?
13. Is workspace file writing permission-scoped?
14. Does QA Surface already have tab/panel extension points?
15. Can tool failures carry structured extra metadata such as `evidenceBundleId`?

Do not invent answers. Inspect the repository/runtime first.

---

# 84. Recommended implementation sequence for coding agent

Before changing code:

1. Read current browser runtime implementation.
2. Locate existing `browser_screenshot`.
3. Locate DSH attachment APIs.
4. Locate QA Surface integration.
5. Locate semantic ref/revision storage.
6. Locate browser lifecycle/session cleanup.
7. Document findings.
8. Implement Phase 1 without changing unrelated browser APIs.
9. Add tests.
10. Implement diagnostics buffers.
11. Add evidence bundle.
12. Add failure hook.
13. Only then add trace/visual diff.

---

# 85. Compatibility strategy

Avoid patching DSH core.

Preferred integration order:

```text
existing plugin APIs
→ existing attachment APIs
→ plugin UI extension APIs
→ plugin lifecycle hooks
→ narrowly scoped adapter
→ runtime patch only as last resort
```

All compatibility workarounds should be isolated behind adapters.

Example:

```text
src/integrations/dsh/
├── AttachmentAdapter.ts
├── ArtifactAdapter.ts
└── QaSurfaceAdapter.ts
```

---

# 86. Definition of Done for core feature

Core feature is considered complete when:

- screenshot works for viewport/full-page/element;
- screenshot becomes a durable attachment;
- model can access image when DSH/model supports multimodal input;
- screenshots can be persisted to workspace;
- console/page errors are captured;
- failed network calls are captured;
- evidence bundle is available;
- failed browser actions automatically produce evidence;
- secrets are redacted;
- buffers are bounded;
- QA Surface exposes captured evidence;
- session cleanup does not leak listeners/files;
- tests cover failure and security cases;
- existing browser interaction tools remain compatible.

---

# 87. Future direction

Long-term `dsh-qa-browser` can become:

```text
browser automation
+ semantic interaction
+ visual inspection
+ debugging
+ evidence collection
+ visual regression
+ tracing
+ agent-observable QA
```

rather than just another Playwright wrapper.

The important architectural boundary is:

```text
Browser runtime performs capture and evidence collection.
DSH controls model delivery and artifact lifecycle.
Vision/model layer performs interpretation.
QA Surface provides human observability.
```

This keeps the plugin modular and prevents browser automation, model-provider logic and UI from collapsing into one tightly coupled subsystem.
