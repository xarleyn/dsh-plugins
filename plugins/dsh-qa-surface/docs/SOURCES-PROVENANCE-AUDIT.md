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

The first slice rebuilds `QaTurnSources` from persisted `tool/result` metadata.
Consequently reload/replay is deterministic without rerunning tools, although a
separate materialized `qa/sources` event is not written yet.

There is an upstream API gap for that materialized event in `0.1.5-rc.2`:

- downstream packages may declaration-merge `SessionEventMap`;
- persistence requires unknown downstream events to carry
  `SessionEvent.ignorable === true`;
- public `Session.append(type, data)` does not expose an envelope option for
  `ignorable`, and its implementation constructs the envelope internally.

Writing `qa/sources` through a runtime patch would therefore risk producing a
log that a fresh pinned DSH process refuses to restore. The implementation must
not add such a patch. The next persistence step needs either an upstream
ignorable-event append API or a plugin-owned sidecar store.

## Subagent lifecycle

The pinned `@deepseek-ai/dsh-subagent` does expose process-local
`subagent/start` and `subagent/end` events. Both carry `runId`, `provider`, child
session `id`, and `local`; the terminal payload additionally carries
`stopReason` and optional `lastAssistantMessage`. Scoped dispatch is keyed by
the delegating parent.

This is sufficient for the next phase's lineage registry. Observable local
children can be read from their durable session logs. Opaque providers will
still need the specified report-tool fallback and completeness tracking.

## File preview reuse

The current QA plugin has an attachment reader, but no browser-visible,
source-scoped local text-file reader. A preview remote must therefore be narrow,
read-only, tied to paths already present in the canonical bundle, and validated
against the attested session workspace. It must not expose general filesystem
navigation.

## Implemented first slice

- canonical source and turn-bundle types;
- URL/path/range normalization;
- extractor registry with read, grep discovery, web search, and web fetch;
- evidence promotion, deduplication, ranking, and a default display threshold;
- bounded structured web-search promotion (five results by default);
- per-turn projection from durable conversation metadata;
- one canonical snapshot used by the answer footer and Sources drawer.

Remaining work starts with Host-side lineage/subagent inheritance and the
persistence decision described above, followed by grouped UX and secure file
preview.
