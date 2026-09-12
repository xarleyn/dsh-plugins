# SPEC: Structured Sources / Provenance for `dsh-qa-surface`

Status: Draft / implementation plan  
Target: `plugins/dsh-qa-surface`  
Scope: source collection, source inheritance from subagents, unified source UI, source preview, Markdown rendering for local `.md` files

---

## 1. Goal

Доработать `dsh-qa-surface` так, чтобы источники ответа перестали быть свободно оформленным текстом, который LLM вручную дописывает в конец ответа, и стали **структурированными данными, собираемыми плагином автоматически**.

После доработки:

- главный агент не обязан вручную формировать раздел `Источники`;
- источники собираются из фактических tool calls/results текущего turn;
- источники субагентов автоматически наследуются родительским turn;
- один и тот же структурированный набор источников используется:
  - в правой панели Sources;
  - в компактном footer под ответом;
  - при необходимости — для inline citations;
- одинаковые источники дедуплицируются;
- web search discovery не раздувает список до десятков/сотен малоценных ссылок;
- локальные файловые источники можно открыть прямо из QA UI;
- `.md` / `.markdown` файлы по умолчанию открываются как отформатированный Markdown, а не как plain text;
- у Markdown preview есть переключение `Rendered / Raw`;
- источник сохраняет происхождение: parent agent / subagent / конкретный tool call / turn.

Главный принцип:

> **LLM отвечает за содержание ответа. Плагин отвечает за provenance и отображение источников.**

Не использовать natural-language блок `Источники` в assistant message как canonical source of truth.

---

## 2. Current problems

По текущему UX наблюдаются несколько проблем.

### 2.1. Источники в ответе нестабильны

LLM может оформить их как:

```md
## Источники

1. Документация ...
2. Jira ...
3. Confluence ...
4. Код ...
```

или в другом порядке/формате, объединить несколько ссылок в одну строку, забыть часть источников, добавить текст без URL, поменять названия секций и т.п.

Это делает формат зависимым от модели и prompt adherence.

### 2.2. Ответ и Sources sidebar расходятся

Источник может присутствовать в тексте ответа, но отсутствовать в боковом списке, или наоборот.

Причина архитектурная: две поверхности получают данные разными путями.

### 2.3. Список Sources слишком шумный

Текущий Activity/Sources может показывать десятки web результатов (`Web · 72`, `Sources · 100`). Для QA-пользователя это практически не отличается от лога поискового движка.

Особенно плохо считать каждый результат `web_search` полноценным использованным источником, если агент реально открыл/прочитал только несколько страниц.

### 2.4. Источники субагентов теряются

Parent agent видит финальный ответ child/subagent, но provenance внутренних tool calls ребёнка может не попадать в итоговый source list родительского turn.

### 2.5. File preview слишком сырой

Markdown-файлы сейчас могут открываться как raw/plain text. Для документации это заметно хуже стандартного rendered Markdown.

---

## 3. Non-goals

В рамках этой доработки не требуется:

- строить полноценную citation-verification систему, доказывающую, что каждая фраза ответа логически подтверждается источником;
- автоматически генерировать библиографию в академическом стиле;
- делать editable file viewer;
- выполнять JavaScript/HTML из Markdown;
- давать QA-пользователю filesystem navigation;
- открывать произвольные файлы, которые агент не использовал как source;
- превращать каждый grep/glob/search hit в пользовательский источник;
- менять read-only/security policy `/qa`;
- форкать DSH core ради source tracking.

---

## 4. Design principles

### 4.1. Structured first

Canonical representation источника — typed object, а не строка Markdown.

### 4.2. Observe actual tool usage

Плагин должен в первую очередь собирать provenance из tool presentation/result metadata и session events.

Не просить LLM повторно пересказывать то, что runtime уже знает.

### 4.3. Evidence != discovery

Нужно различать:

- **evidence / consumed source** — документ реально был прочитан/получен агентом;
- **discovery candidate** — ссылка/файл только встретился в поисковой выдаче;
- **navigation artifact** — glob/list/grep entry, использованный только для навигации.

Основной Sources UI показывает evidence sources.

Discovery candidates могут быть доступны в debug/activity view, но не должны автоматически раздувать пользовательский список Sources.

### 4.4. Same data for every presentation

Sources sidebar, footer и inline citation resolver должны получать один `QaTurnSources` snapshot.

### 4.5. Fail soft, not silently wrong

Если provenance конкретного внешнего subagent provider недоступен, UI должен уметь показать:

```text
Sources may be incomplete for 1 delegated run
```

в debug mode, а не притворяться, что список гарантированно полный.

### 4.6. Reuse DSH structured presentation metadata

DSH уже имеет structured tool presentation types, включая:

- file read result (`ReadResultView` с `path`, `offset`, numbered `lines`, `totalLines`, `lang`);
- file search result (`SearchResultView`);
- web search result (`WebSearchResultView.sources`);
- web fetch result (`WebFetchResultView.url`);
- generic call locations (`FileLocation`).

Где эти данные доступны, extractor обязан использовать их вместо regex parsing model-facing text.

---

## 5. High-level architecture

```text
                         Parent Agent
                             │
                  tool calls / tool results
                             │
                             ▼
                    ┌──────────────────┐
                    │ Source Collector │◄─────────────┐
                    └────────┬─────────┘              │
                             │                        │
                normalize / classify / dedupe        │
                             │                        │
                             │               Child/Subagent tools
                             │                        │
                             │              ┌─────────┴─────────┐
                             │              │ Subagent lineage  │
                             │              │ + child collector │
                             │              └─────────┬─────────┘
                             │                        │
                             └────────────┬───────────┘
                                          │
                                      turn/end
                                          │
                                          ▼
                              ┌─────────────────────┐
                              │ qa/sources event    │
                              │ QaTurnSources       │
                              └──────────┬──────────┘
                                         │
                         ┌───────────────┼────────────────┐
                         │               │                │
                         ▼               ▼                ▼
                  Sources sidebar   Answer footer   Inline citation
                                                     resolver
                         │
                         ▼
                  Source preview
                         │
            ┌────────────┴────────────┐
            │                         │
         Web/Jira/...             Local file
                                      │
                           ┌──────────┴──────────┐
                           │ Markdown | Raw text │
                           └─────────────────────┘
```

---

## 6. Canonical data model

Suggested types:

```ts
export type QaSourceKind =
  "file" | "code" | "web" | "jira" | "confluence" | "knowledge" | "other";

export type QaSourceEvidence =
  "read" | "fetched" | "queried" | "reported" | "inherited" | "discovered";

export interface QaSourceLocation {
  path?: string;
  lineStart?: number;
  lineEnd?: number;
  anchor?: string;

  jiraKey?: string;
  confluencePageId?: string;
}

export interface QaSourceOrigin {
  sessionId: string;
  turn: number;
  step?: number;
  toolCallId?: string;
  toolName?: string;

  agentId?: string;
  role: "parent" | "subagent";

  subagentRunId?: string;
  subagentSessionId?: string;
}

export interface QaSourceReference {
  /** Stable canonical identity after normalization. */
  id: string;

  kind: QaSourceKind;
  title: string;

  /** Click target for remote sources. */
  uri?: string;

  /** Canonical path for workspace/local sources. */
  path?: string;

  /** Optional human-facing description/snippet. */
  snippet?: string;

  /** All useful ranges/anchors retained after dedupe. */
  locations: QaSourceLocation[];

  /** Why this object is considered a source. */
  evidence: QaSourceEvidence;

  /** All parent/subagent/tool origins merged by dedupe. */
  origins: QaSourceOrigin[];

  /** Higher means more suitable for main Sources UI. */
  score: number;

  metadata?: Record<string, unknown>;
}

export interface QaTurnSources {
  version: 1;
  sessionId: string;
  turn: number;

  sources: QaSourceReference[];

  /** Optional low-value candidates hidden from the default source list. */
  discovered?: QaSourceReference[];

  complete: boolean;

  incompleteOrigins?: Array<{
    subagentRunId?: string;
    provider?: string;
    reason: string;
  }>;
}
```

### 6.1. Why keep `origins[]`

Если один и тот же документ:

- прочитал parent;
- затем прочитал subagent A;
- затем открыл subagent B;

в UI должен оставаться один source card, но debug details могут показать `Used by 3 agent runs`.

### 6.2. Stable ID rules

Recommended canonical IDs:

```text
file:<workspace-relative-canonical-path>
web:<canonical-url>
jira:<issue-key>
confluence:<space-or-page-id>
knowledge:<backend>:<document-id>
```

Line ranges **не включать** в primary source ID.

Несколько ranges одного файла должны merge'иться в `locations[]`.

---

## 7. Source collection

### 7.1. Preferred integration point

Primary collection path:

1. observe completed tool results;
2. resolve structured presentation/result metadata;
3. pass the final typed result through an extractor;
4. add normalized references to the active turn collector.

Implementation should prefer DSH's final tool-result observation seam / durable `tool/result` event rather than parsing call text before execution.

Why:

- result already knows whether the call succeeded;
- final redirect URL can be known for web fetch;
- read presentation contains structured path/lines;
- web search presentation contains structured source objects;
- session replay can reproduce persisted result metadata.

### 7.2. Extractor registry

Do not write one large `switch(toolName)`.

Suggested registry:

```ts
interface SourceExtractorContext {
  toolName: string;
  args: unknown;
  result: unknown;
  presentation?: unknown;
  origin: QaSourceOrigin;
}

interface SourceExtractor {
  matches(ctx: SourceExtractorContext): boolean;
  extract(ctx: SourceExtractorContext): QaSourceReference[];
}

class SourceExtractorRegistry {
  register(extractor: SourceExtractor): Disposable;
  extract(ctx: SourceExtractorContext): QaSourceReference[];
}
```

Possible modules:

```text
provenance/extractors/
  read-file.ts
  file-search.ts
  web-search.ts
  web-fetch.ts
  jira.ts
  confluence.ts
  knowledge.ts
  generic-presented-location.ts
  reported-source.ts
```

### 7.3. Built-in DSH file read

For a successful `ReadResultView`:

```ts
{
  card: ("read", path, offset, lines, totalLines, lang);
}
```

create one evidence source:

```text
kind      = file/code
path      = path
evidence  = read
lineStart = first returned line
lineEnd   = last returned line
score     = high
```

Classification:

- documentation-like extension (`.md`, `.markdown`, `.rst`, `.adoc`, `.txt`) → `file`;
- source-code extension → `code`;
- unknown textual → `file`.

### 7.4. grep/content search

`grep` results are useful, but every matched file should not automatically become a high-confidence source.

Recommended behavior:

- file only appears in grep result and is never opened/read → `evidence='discovered'`;
- later `read` on the same file promotes/merges it into evidence source;
- optional config may include grep-only files if the grep snippets themselves materially formed the answer.

Default: keep them in `discovered`, not main Sources.

### 7.5. glob/path search/listing

Treat as navigation only.

Do not show paths from glob/list results in main Sources unless they are subsequently read.

### 7.6. `web_search`

DSH already exposes a structured `WebSearchResultView.sources` list.

Important: these are search results, not necessarily pages meaningfully consumed by the agent.

Therefore:

- initially add each search result as `evidence='discovered'` with low score;
- if the same URL is later fetched/opened, promote to `evidence='fetched'`;
- if the provider's search result itself is the only retrieval mechanism and returns substantive snippets used by the model, allow a bounded number of top search sources to be promoted by policy.

Default policy proposal:

```yaml
sources:
  webSearch:
    showDiscovered: false
    promoteSearchResultsWithoutFetch: true
    maxPromotedPerSearch: 5
```

This avoids current situations like `Web · 72` unless those 72 sources were actually meaningful.

### 7.7. `web_fetch`

Successful fetch = strong evidence source.

Use final redirected URL if DSH supplies it.

```text
kind     = web
evidence = fetched
score    = very high
```

Canonicalize URL before dedupe:

- lowercase host;
- strip known tracking query params (`utm_*`, etc.);
- normalize default port;
- preserve business-relevant query params;
- remove fragment for primary identity unless fragment identifies a distinct documentation section worth keeping as a location/anchor.

Do not aggressively remove arbitrary query params.

### 7.8. Jira

Support explicit Jira extractors for actual Jira/MCP tool names used in the deployment.

Canonical identity:

```text
jira:MDC-24929
```

Data:

```ts
{
  kind: 'jira',
  title: 'MDC-24929 — Вибродоктор. Добавить метод GET /history',
  uri: '<actual issue URL>',
  locations: [{ jiraKey: 'MDC-24929' }],
  evidence: 'queried'
}
```

Only issue read/search-result objects actually returned to the model should count.

Avoid treating login pages, Jira search UI URL, board URLs, etc. as separate sources when a concrete issue is known.

### 7.9. Confluence

Canonical identity should prefer stable page ID over title URL.

```text
confluence:<page-id>
```

Keep:

- page title;
- canonical page URL;
- page id;
- optional space key;
- optional anchor/section.

### 7.10. Custom knowledge tools

Provide a small adapter API so internal KB tools can register their own source extractor without modifying core collector code.

Example:

```ts
ctx.qaSources.registerExtractor({
  id: 'company-kb',
  matches: ({ toolName }) => toolName === 'kb_search' || toolName === 'kb_get',
  extract: ...,
})
```

If exposing a cross-plugin service is too expensive for first version, keep registry internal but design its types so it can be promoted later.

---

## 8. Subagent provenance

This is a required part of the feature, not a later enhancement.

### 8.1. Lineage registry

Observe DSH subagent lifecycle:

```text
subagent/start
subagent/end
```

Maintain a runtime mapping:

```ts
interface SubagentLineage {
  runId: string;
  parentSessionId: string;
  parentTurn: number;
  childAgentId?: string;
  childSessionId?: string;
  provider?: string;
  parentRunId?: string;
}
```

Nested children must be supported recursively.

### 8.2. In-process / observable child agents

When a child session/agent is observable by the current Host:

- collect its tool sources exactly as for the parent;
- mark origin `role='subagent'`;
- associate the child source with the parent turn that initiated the delegation;
- on `subagent/end`, merge collected child evidence into parent `QaTurnSources`;
- retain `subagentRunId` in `origins[]`.

### 8.3. Nested subagents

If child A starts child B:

```text
Parent turn
  └─ A
      └─ B
```

sources from B should bubble to the original parent turn while retaining full origin lineage.

No duplicates should be created when A also reports B's source in its final answer.

### 8.4. Opaque/external child providers

Some providers may not expose internal tool-result traffic to the Host.

For these, automatic observation cannot guarantee complete provenance.

Add a fallback model-facing tool usable by subagents:

```text
qa_report_sources
```

Suggested schema:

```ts
{
  sources: Array<{
    kind: "file" | "web" | "jira" | "confluence" | "knowledge" | "other";
    title: string;
    uri?: string;
    path?: string;
    lineStart?: number;
    lineEnd?: number;
    externalId?: string;
  }>;
}
```

Properties:

- read-only;
- no external side effects;
- only appends provenance to current child run collector;
- can be called multiple times;
- duplicate-safe;
- never mutates workspace;
- preferably hidden/unavailable to ordinary `/qa` parent unless needed.

### 8.5. Companion skill / prompt guidance

Add a short internal instruction for delegated research:

```text
When you use sources that may not be observable by the parent harness,
report them with qa_report_sources before returning your result.
Do not manually format a "Sources" section unless explicitly requested.
```

Important: this skill/tool path is **fallback**, not primary architecture.

The parent agent should not be asked to reconstruct child sources from prose.

### 8.6. Completeness flag

If a child provider is opaque and no `qa_report_sources` calls were received:

```ts
complete = false;
incompleteOrigins.push({
  subagentRunId,
  provider,
  reason:
    "Child tool provenance is not observable and no structured source report was received.",
});
```

In normal QA mode this warning may stay hidden unless the source drawer is expanded into details/debug.

---

## 9. Turn finalization and persistence

### 9.1. Do not add an extra LLM step by default

At the end of the turn the plugin should finalize sources itself.

Desired lifecycle:

```text
turn/start
  collector.open(parent session, turn)

...tool results...
...subagent starts/results/ends...

turn/end
  collector.finalize()
  append durable qa/sources event
```

### 9.2. Custom session event

Use a plugin-owned durable session event if current DSH plugin API allows SessionEventMap declaration merging.

Suggested event:

```ts
declare module "@deepseek-ai/dsh-session" {
  interface SessionEventMap {
    "qa/sources": QaTurnSources;
  }
}
```

The event should be log-only / non-message-producing.

It must not enter model conversation history.

### 9.3. Why persist it

Persistence is required so:

- session reload produces the same source list;
- UI does not have to re-run extraction over old raw tool text;
- source dedupe/order stays stable;
- source panel works for historical turns;
- future migrations can version the source payload.

### 9.4. Replay / migration

For old sessions without `qa/sources`:

Preferred fallback:

1. reconstruct from historical structured `tool/result` metadata where possible;
2. do not parse arbitrary final `## Источники` prose by default;
3. optionally allow one-time legacy parser behind config.

```yaml
sources:
  legacy:
    parseAssistantSourcesBlock: false
```

Reason: natural-language parsing would reintroduce the very ambiguity this feature is intended to remove.

---

## 10. Dedupe and ranking

### 10.1. Dedupe

Merge same canonical source across:

- repeated reads;
- parent + child;
- multiple subagents;
- web search + web fetch;
- multiple line ranges;
- repeated Jira/Confluence fetches.

Merge rules:

```text
title      -> prefer explicit resource title over filename/domain fallback
uri        -> prefer canonical/final URL
locations  -> union + compact overlapping line ranges
origins    -> union
snippet    -> keep best non-empty snippet
score      -> max / recompute from strongest evidence
```

### 10.2. Evidence promotion

Example:

```text
web_search result  -> discovered, score 20
web_fetch same URL -> fetched, score 100
```

Final source becomes one object with `evidence='fetched'`.

### 10.3. Suggested scoring

Initial policy, configurable later:

| Event                           | Score |
| ------------------------------- | ----: |
| explicit file read              |   100 |
| web fetch                       |   100 |
| Jira issue read                 |   100 |
| Confluence page read            |   100 |
| knowledge document get          |   100 |
| structured subagent report      |    90 |
| web search source without fetch |    55 |
| grep matched file without read  |    30 |
| glob/path discovery             |    10 |

### 10.4. Default display threshold

Main Sources UI should show `score >= 50` by default.

Lower-score objects remain available in diagnostics if retained.

---

## 11. Source count semantics

Current `Sources · 100` style count is not useful if it includes every discovery result.

Change semantics:

```text
Sources · N
```

where `N` = unique evidence sources shown by default after dedupe/promotion/filtering.

Optional debug row:

```text
Discovered · 73
```

should be collapsed/hidden unless explicitly enabled.

This makes the count understandable to a QA user.

---

## 12. Sources UI redesign

The UI should look like a product source browser, not raw tool activity.

### 12.1. Main drawer

Suggested layout:

```text
┌──────────────────────────────────────────┐
│ Sources                              ✕   │
│ 12 sources                                │
├──────────────────────────────────────────┤
│ Documentation · 4                        │
│                                          │
│  [MD] technicalDiagnosis.md              │
│       EAM / technicalDiagnosis           │
│       lines 197–218        Used by agent │
│                                          │
│  [MD] products_eam.md                    │
│       AIS_Dispatcher / products          │
│                                          │
│ Jira · 3                                 │
│                                          │
│  [J] MDC-24929                           │
│      Вибродоктор. GET /history           │
│                                          │
│ Confluence · 2                           │
│ ...                                      │
│                                          │
│ Web · 3                                  │
│ ...                                      │
└──────────────────────────────────────────┘
```

### 12.2. Grouping

Default group order:

1. Documentation / Files
2. Code
3. Jira
4. Confluence
5. Knowledge
6. Web
7. Other

Do not sort alphabetically across categories.

Within group sort by:

1. score descending;
2. first use/order in turn;
3. title.

### 12.3. Card content

Each card may show:

- source icon / type badge;
- short title;
- path/domain/space;
- line range or issue key;
- optional favicon/service icon;
- optional `Subagent` indicator;
- optional `Used by N agents` only in details/tooltip;
- external-link icon for remote resources.

Avoid showing long raw URLs if title exists.

### 12.4. Source details

On hover/secondary details:

```text
Used by:
- Parent · read · turn 4
- Subagent "Search Jira" · jira_get

Locations:
- lines 197–218
- lines 355–371
```

This is useful for debugging but should not clutter the default card.

### 12.5. Footer under answer

Replace free-form model-written `## Источники` with a deterministic UI footer.

Example compact state:

```text
Sources  12   [Documentation 4] [Jira 3] [Confluence 2] [Web 3]  ›
```

Expanded:

```text
Sources

Documentation
• technicalDiagnosis.md · 197–218
• products_eam.md

Jira
• MDC-24929 — Вибродоктор. GET /history
...
```

Both footer and drawer must render from the same `QaTurnSources` object.

### 12.6. Avoid duplicated textual Sources block

Add system-prompt guidance:

```text
The QA surface renders collected sources automatically.
Do not append a manual Sources/Источники section unless the user explicitly asks for a textual bibliography.
```

Do not depend on this for data correctness; it is only to avoid duplicate visual output.

---

## 13. File source preview

### 13.1. Click behavior

Clicking a local file source opens a source preview surface (existing drawer/modal/dock area is acceptable).

Header example:

```text
Library / docs / User_Guide / EAM / ... / technicalDiagnosis.md
                                              Raw/Rendered   Download   ✕
```

### 13.2. Markdown default

For extensions:

```text
.md
.markdown
```

open in `Rendered` mode by default.

For ordinary source code/text:

- use existing line-numbered/syntax-highlighted text/code preview;
- default to raw/code presentation.

### 13.3. Rendered / Raw toggle

For Markdown provide:

```text
[Rendered] [Raw]
```

State can be local to the preview component.

Optional: remember preference per extension for current browser session.

### 13.4. Reuse DSH `MarkdownText`

Preferred implementation: use the existing DSH `MarkdownText` primitive from `@deepseek-ai/dsh-client-ui-primitives` if accessible through the plugin's supported dependency/injection model.

Reasons:

- already supports GFM-style Markdown;
- already handles untrusted assistant Markdown safely;
- raw HTML is not executed;
- links are constrained/sanitized;
- style matches the rest of DSH Web.

Do not introduce a second unrelated Markdown renderer unless the existing primitive cannot be cleanly consumed from an out-of-tree plugin.

If direct cross-package value import violates the current DSH client-plugin boundary in the exact target version, either:

1. use the officially allowed package dependency if the package is a public primitive library;
2. expose an internal qa-surface renderer adapter;
3. as fallback, use a minimal Markdown renderer with equivalent sanitization behavior.

Do not render Markdown with `dangerouslySetInnerHTML` from unsanitized source.

### 13.5. Markdown features

Required:

- headings;
- paragraphs;
- lists;
- blockquotes;
- inline/fenced code;
- tables;
- links;
- emphasis/strong;
- horizontal rules.

Nice-to-have:

- task lists;
- KaTeX if already inherited from DSH renderer;
- anchor navigation;
- syntax highlighting inside fenced blocks.

### 13.6. Relative links inside Markdown

A Markdown document may contain:

```md
[See architecture](../architecture.md)
```

Phase 1:

- do not navigate browser to arbitrary relative URL;
- render it as a safe file-source link only if target can be resolved inside allowed QA workspace root;
- otherwise show as non-clickable or raw link text.

Phase 2 may allow opening linked local Markdown documents in the same previewer, but only through Host-side canonical path validation.

### 13.7. Line highlighting

If source has a line range:

```text
technicalDiagnosis.md · lines 197–218
```

Raw mode should scroll to and visually highlight that range.

Rendered Markdown cannot reliably map every original source line to exact DOM nodes after Markdown parsing.

Therefore:

- best effort: scroll to nearest heading/section if an anchor is available;
- provide a visible `Referenced lines: 197–218` chip;
- `View raw at lines 197–218` jumps to exact raw line range.

Do not fake exact rendered-line highlighting.

### 13.8. Large files

Avoid loading/rendering unlimited files in browser.

Suggested defaults:

```yaml
sources:
  filePreview:
    maxBytes: 2_000_000
    maxMarkdownRenderBytes: 1_000_000
```

If too large:

```text
This file is too large for rendered preview.
[Open raw excerpt] [Download]
```

Use existing Host/file read service where possible rather than exposing a new unrestricted arbitrary-file HTTP endpoint.

---

## 14. Remote source behavior

### Web

Click opens canonical URL in new tab with safe `noopener/noreferrer` behavior.

Optional future enhancement: cached fetched-text preview, but not required now.

### Jira / Confluence

Default:

- open canonical application URL in new tab;
- if a structured content payload was already returned by the connector/tool, optionally show an in-QA preview before external navigation.

Do not store credentials in the browser for source rendering.

---

## 15. Inline citations (optional phase)

This is not required for MVP, but the data model should allow it.

Possible model guidance:

```text
When useful, cite collected sources by stable id:
[[source:file:docs/foo.md]]
[[source:jira:MDC-24929]]
```

UI converts them into compact citation chips such as `[1]`.

However do not make `QaTurnSources` dependent on inline citations.

Sources must still be collected even if the model emits zero citation markers.

No extra turn-stopping LLM rewrite by default.

---

## 16. Proposed configuration

```yaml
sources:
  enabled: true

  collect:
    parentAgent: true
    subagents: true
    persistTurnEvent: true

  display:
    sidebar: true
    footer: true
    groupByKind: true
    showDiscovered: false
    showOriginBadges: false
    maxInitiallyVisiblePerGroup: 8

  webSearch:
    promoteSearchResultsWithoutFetch: true
    maxPromotedPerSearch: 5

  dedupe:
    normalizeUrls: true
    stripTrackingParams: true
    mergeFileRanges: true

  filePreview:
    enabled: true
    markdownRenderedByDefault: true
    allowRawToggle: true
    maxBytes: 2000000
    maxMarkdownRenderBytes: 1000000

  subagents:
    inheritSources: true
    enableReportToolFallback: true
    markIncompleteOpaqueRuns: true

  legacy:
    parseAssistantSourcesBlock: false
```

All defaults should remain compatible with `/qa` read-only mode.

---

## 17. Suggested code structure

Adapt to the actual current plugin layout after repository audit.

```text
plugins/dsh-qa-surface/
  src/
    host/
      provenance/
        types.ts
        collector.ts
        turn-store.ts
        normalize.ts
        dedupe.ts
        scoring.ts
        lineage.ts
        event.ts

        extractors/
          registry.ts
          read-file.ts
          file-search.ts
          web-search.ts
          web-fetch.ts
          jira.ts
          confluence.ts
          knowledge.ts
          generic-location.ts
          reported.ts

        tools/
          report-sources.ts

        prompt/
          source-guidance.ts

      remotes/
        sources.ts
        file-preview.ts

    client/
      sources/
        SourcesPanel.tsx
        SourcesGroup.tsx
        SourceCard.tsx
        SourceFooter.tsx
        SourceIcon.tsx
        SourceDetails.tsx
        source-store.ts

      preview/
        SourcePreview.tsx
        FilePreview.tsx
        MarkdownPreview.tsx
        RawFilePreview.tsx
        PreviewHeader.tsx

      styles/
        sources.module.css
        preview.module.css
```

If the plugin already has host/client folders with different naming, preserve existing conventions instead of mechanically applying this tree.

---

## 18. Host/client contract

The browser should not infer sources from rendered chat nodes.

Preferred flow:

```text
Host persisted qa/sources event
       ↓
existing session transport / remote projection
       ↓
client source store keyed by sessionId + turn
       ↓
SourcesPanel / SourceFooter
```

For file preview, use an explicit read-only Host capability with workspace-root validation if the existing DSH workspace-file read service cannot be reused.

Example narrow contract:

```ts
interface QaSourcePreviewApi {
  readFile(input: {
    sessionId: string;
    path: string;
    maxBytes?: number;
  }): Promise<{
    path: string;
    content: string;
    size: number;
    truncated: boolean;
    mime?: string;
  }>;
}
```

Security requirements:

- canonicalize path on Host;
- ensure path is inside allowed workspace/root;
- reject symlink escape according to the deployment's existing file security semantics;
- no arbitrary absolute-path browser API;
- no write endpoint;
- source preview request does not relax QA sandbox/tool policy.

---

## 19. Source presentation mapping

Suggested source labels/icons:

| Kind         | Label                | Example                      |
| ------------ | -------------------- | ---------------------------- |
| `file`       | Documentation / File | `technicalDiagnosis.md`      |
| `code`       | Code                 | `ActivitySectionTypeEnum.cs` |
| `jira`       | Jira                 | `MDC-24929`                  |
| `confluence` | Confluence           | `Вибродиагностика MM3`       |
| `knowledge`  | Knowledge            | KB document                  |
| `web`        | Web                  | GitHub / docs site           |
| `other`      | Other                | connector-specific source    |

Web source title fallback order:

1. tool/provider supplied title;
2. page title cached by fetch;
3. hostname + shortened path;
4. raw URL only as last resort.

File title:

- primary: basename;
- secondary: shortened directory path;
- never show huge absolute host filesystem path to QA user if workspace-relative path is available.

---

## 20. UI states

### No sources

Do not render an empty `Sources` footer.

Sidebar source action may be hidden/disabled.

### Loading / active turn

Sources may appear incrementally while the turn is running, but mark them as provisional.

At `turn/end`, replace with finalized snapshot.

### Error

Source preview failure:

```text
Could not open this source.
The source may have moved or is no longer accessible.
```

Do not expose raw Host stack traces.

### Truncated source

Show a small `Partial` badge if file/web result was truncated.

### Incomplete subagent provenance

Only show in debug/details by default:

```text
Some delegated-source provenance is unavailable.
```

---

## 21. Testing plan

### 21.1. Unit: normalization

Test:

- URL canonicalization;
- tracking parameter removal;
- Jira key canonicalization;
- Confluence page-id identity;
- workspace path normalization;
- line-range compaction.

### 21.2. Unit: dedupe

Cases:

- same URL from search + fetch;
- same file read twice at overlapping ranges;
- same Jira issue by parent + child;
- same source from nested subagents;
- stronger evidence promotes weaker evidence.

### 21.3. Unit: extractors

Fixtures for:

- DSH `ReadResultView`;
- DSH `SearchResultView`;
- DSH `WebSearchResultView`;
- DSH `WebFetchResultView`;
- Jira connector payload;
- Confluence connector payload;
- structured `qa_report_sources` input.

### 21.4. Integration: turn lifecycle

Scenario:

```text
user prompt
→ parent reads docs/a.md
→ parent web_search returns 10 results
→ parent fetches 2 results
→ turn ends
```

Expected:

- `docs/a.md` included;
- 2 fetched web pages included;
- at most configured number of search-only results included;
- no duplicates;
- persisted `qa/sources` event exists.

### 21.5. Integration: subagent inheritance

Scenario:

```text
parent
→ starts child A
  → reads docs/a.md
  → reads Jira MDC-1
→ child ends
→ parent reads docs/a.md
→ parent ends
```

Expected:

- one `docs/a.md` card with parent + child origins;
- one Jira card;
- parent turn source bundle owns both.

### 21.6. Integration: nested subagent

Parent → A → B, B reads source.

Expected source appears in parent turn with nested origin chain preserved.

### 21.7. Integration: opaque provider fallback

Opaque child calls `qa_report_sources`.

Expected reported source merged into parent bundle.

Opaque child does not report.

Expected `complete=false` and incomplete origin metadata.

### 21.8. UI: source panel

Test:

- grouping;
- counts;
- dedupe;
- collapsed/expanded groups;
- long titles;
- source click;
- external-link behavior;
- subagent badge/details;
- zero-state.

### 21.9. UI: Markdown preview

Test `.md` file with:

- headings;
- lists;
- table;
- fenced code;
- links;
- HTML/script attempt;
- large document;
- rendered/raw switch;
- referenced line range.

Unsafe HTML/script must not execute.

### 21.10. Reload/replay

Reload browser/session.

Expected source order and counts remain identical without re-running tools.

---

## 22. Acceptance criteria

Feature is complete when all of the following hold:

1. Final assistant response no longer needs to manually produce a Sources section.
2. A turn that reads/fetches known resources produces a structured `QaTurnSources` bundle automatically.
3. Sources panel and answer footer use the same bundle.
4. Repeated sources are deduplicated.
5. Parent and observable subagent sources are merged into one turn-level source set.
6. Nested subagent sources are inherited.
7. Opaque subagents have `qa_report_sources` fallback and completeness tracking.
8. Web search results do not automatically flood the main source list with every candidate.
9. `Sources · N` reflects unique visible evidence sources, not raw tool-result count.
10. File source cards open a safe file preview.
11. `.md` and `.markdown` open rendered by default.
12. Markdown preview offers `Rendered / Raw` toggle.
13. Raw mode can jump to referenced line range.
14. Markdown rendering does not execute raw HTML/JS.
15. Session reload restores the same source bundle from persisted state.
16. Source collection does not require an extra LLM call at end of every turn.
17. `/qa` remains read-only; source preview introduces no write/control capability.
18. Existing non-QA DSH UI remains unaffected unless explicitly wired to the new source service.

---

## 23. Implementation phases

### Phase 0 — audit current `dsh-qa-surface`

Before coding:

- identify current source-panel implementation;
- identify how current DSH Sources/Activity data reaches QA UI;
- identify available tool presentation metadata in the pinned DSH version;
- identify exact subagent lifecycle payloads;
- identify existing file preview/read remote that can be reused;
- identify whether `MarkdownText` is safely consumable by the out-of-tree client plugin.

Do not duplicate an existing DSH service if current version already exposes equivalent structured source/file-preview capabilities.

### Phase 1 — structured parent sources

Implement:

- canonical types;
- extractor registry;
- read/web extractors;
- dedupe/ranking;
- turn collector;
- persisted `qa/sources`;
- simple source panel bound to structured bundle.

No subagents yet only if needed to keep the first PR reviewable, but types must already support origins.

### Phase 2 — subagents

Implement:

- `subagent/start/end` lineage;
- child collection;
- nested inheritance;
- `qa_report_sources` fallback;
- completeness metadata.

### Phase 3 — polished Sources UX

Implement:

- grouped cards;
- compact footer;
- source details;
- useful count semantics;
- hide discovery noise;
- icons/badges.

### Phase 4 — file preview + Markdown

Implement:

- click-to-preview;
- secure Host file read/reuse existing service;
- `Rendered / Raw`;
- DSH `MarkdownText` reuse;
- line-range jump in raw mode;
- size limits.

### Phase 5 — optional inline citations

Only after structured source data is stable.

Do not block MVP on inline citation generation.

---

## 24. Migration from current textual Sources behavior

During transition:

1. keep current source panel available behind feature flag if needed;
2. enable structured collector;
3. compare structured source bundle to current UI during development;
4. switch Sources panel to structured bundle;
5. add system guidance suppressing manual `Источники` block;
6. remove any code that parses assistant prose into Sources;
7. retain optional legacy parser only for historical sessions if genuinely needed.

Feature flags example:

```yaml
sources:
  implementation: structured # structured | legacy
```

Remove `legacy` after migration period if no longer required.

---

## 25. Important implementation constraints

### Do

- treat session/tool metadata as authority;
- preserve provenance across replay;
- reuse DSH presentation metadata;
- keep Host-side path validation;
- keep source UI deterministic;
- store source origin information even if default UI hides it;
- make source extractors independently testable;
- preserve current plugin's out-of-tree installability.

### Do not

- regex-parse arbitrary final assistant text as the main source mechanism;
- require the parent LLM to copy child sources into its final answer;
- show every `web_search` result as an equal source;
- expose an arbitrary file-read endpoint to the browser;
- use unsanitized `dangerouslySetInnerHTML` for Markdown;
- make source collection depend on a second completion after `turn/end`;
- fork DSH core for logic that can live in the plugin.

---

## 26. Notes for coding agent

1. Start by reading the current `plugins/dsh-qa-surface` source. This SPEC describes target behavior, not assumed current file names.
2. Verify APIs against the exact DSH version pinned by the monorepo before coding; upstream DSH is moving quickly.
3. Prefer typed DSH tool presentation metadata over tool-name-specific text parsing.
4. Keep extraction adapters narrow; Jira/Confluence payloads may vary by MCP/provider.
5. If the current DSH Sources panel already exposes a structured source model that covers part of this design, reuse/adapt it instead of building a parallel source universe.
6. Add tests with representative real payload fixtures from the currently configured Jira/Confluence/web tools.
7. Keep all source-preview capabilities read-only and compatible with the existing `/qa` lockdown policy.
8. If implementation discovers a required upstream gap, document the gap before introducing a runtime patch.

---

## 27. Relevant upstream DSH references

These are architecture references for implementation; verify against the exact pinned commit/version during development.

- DSH tool subsystem / execution pipeline:  
  `https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/tools.md`

- Structured tool presentation types (`ReadResultView`, `WebSearchResultView`, `WebFetchResultView`, file/search views):  
  `https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/tools/src/presentation.ts`

- Session event model / extensible `SessionEventMap`:  
  `https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md`

- Subagent lifecycle (`subagent/start`, `subagent/end`):  
  `https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/subagent.md`

- Web client architecture:  
  `https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/web-client.md`

- DSH Markdown primitive / UI primitives documentation:  
  `https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/client/ui-primitives`

---

## 28. Desired end-state example

User asks a QA question.

Internally:

```text
parent
├─ read docs/User_Guide/EAM/.../technicalDiagnosis.md:197-218
├─ subagent "Jira research"
│  ├─ Jira MDC-24929
│  ├─ Jira MDC-23617
│  └─ Confluence page 12345
├─ web_search -> 10 candidates
└─ web_fetch -> 2 actual pages
```

Assistant only writes the answer.

No manually generated bibliography is required.

QA UI renders:

```text
Ответ ...

────────────────────────────────────────
Sources · 7
Documentation 1 · Jira 2 · Confluence 1 · Web 2 · ...
```

Opening `technicalDiagnosis.md` shows:

```text
[Rendered] [Raw]

# Technical Diagnosis

...proper formatted Markdown...
```

`Raw` jumps to lines `197–218`.

The Sources sidebar shows the exact same seven canonical source objects, grouped and deduplicated, including sources obtained by the subagent.

That is the target behavior.
