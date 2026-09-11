# Sources / provenance implementation audit

Date: 2026-09-11  
Pinned DSH development API: `0.1.5-rc.2`

This note records the Phase 0 findings for
`SPEC-dsh-qa-surface-sources-provenance.md`. It is intentionally tied to the
versions in this repository rather than to DSH `master`.

## Existing QA data path

- `QaSessionController` binds the client `UiConversation` snapshot.
- `QaTranscriptAdapter` reads the `chat.legacy` projection.
- The former Sources drawer inferred one row from selected tool names and raw
  arguments. It counted a search query as a source and did not retain turn,
  line-range, evidence, or origin data.
- `ToolResultNode.meta` is available in the client projection. DSH documents it
  as the tool-private, JSON-safe result presentation payload persisted on the
  corresponding `tool/result` event.

## Structured metadata available in the pinned version

`@deepseek-ai/dsh-tools` exports the provider-neutral result shapes needed by
the first implementation slice:

- `ReadResultView`: `path`, numbered `lines`, `offset`, `totalLines`, `lang`;
- `SearchResultView`: grouped grep matches or path discovery;
- `WebSearchResultView`: structured `sources[]` and truncation state;
- `WebFetchResultView`: final redirect URL, status, and truncation state;
- generic call `FileLocation` values.

The QA extractor layer therefore consumes `ToolResultNode.meta` first and uses
tool arguments only as a compatibility fallback for direct read/fetch calls.
It does not parse assistant prose.

## Replay and persistence

The completed implementation rebuilds collectors from persisted
`tool/call`/`tool/result.meta` events and writes one materialized `qa/sources`
snapshot at `agent/turn-stopping`. The type is declaration-merged into
`SessionEventMap`.

The pinned DSH exports its live `KNOWN_SESSION_EVENT_TYPES` set. As already
demonstrated by the repository's `dsh-session-scope` plugin, registering the
plugin event there is the supported compatibility mechanism when
`Session.append` cannot mark an extension event ignorable. Registration is
effect-scoped and removed on plugin disposal. A Host that owns sessions with
these events must load `dsh-qa-surface`, just as it must load any plugin that
owns a required durable event vocabulary.

## Subagent lifecycle

The pinned `@deepseek-ai/dsh-subagent` does expose process-local
`subagent/start` and `subagent/end` events. Both carry `runId`, `provider`, child
session `id`, and `local`; the terminal payload additionally carries
`stopReason` and optional `lastAssistantMessage`. Scoped dispatch is keyed by
the delegating parent.

The Host now maintains that lineage registry, uses the child header or causal
`AgentRegistry.currentInitiator()` attribution, bubbles nested local-child
sources to the original root turn, and retains run/session origin fields.
Opaque providers can call `qa_report_sources`; an unreported opaque run sets
`complete=false` with an `incompleteOrigins` entry.

## File preview reuse

The new `readSourceFile` Remote is limited to evidence paths in canonical
bundles, re-attests the session, resolves both root and target with `realpath`,
rejects traversal/symlink escape, caps bytes, and exposes no write/list API.

## Implemented scope

- canonical source and turn-bundle types;
- URL/path/range normalization;
- extractor registry with read, grep discovery, web search, and web fetch;
- evidence promotion, deduplication, ranking, and a default display threshold;
- bounded structured web-search promotion (five results by default);
- Host per-turn collectors and materialized/replayable `qa/sources` events;
- local and nested subagent inheritance plus opaque-provider reporting;
- structured Jira, Confluence, knowledge and reported-source adapters;
- one canonical snapshot used by grouped drawer and answer footer;
- source details, origin/partial badges and completeness state;
- safe local-file preview, rendered/raw Markdown, range chips and exact raw
  line highlighting;
- configuration and tests for the feature surface.

Optional inline citation rendering (SPEC Phase 5) remains intentionally out of
the MVP, as specified.
