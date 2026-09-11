# Structured sources migration

`dsh-qa-surface` now treats `QaTurnSources` as the only canonical provenance
model. Assistant prose is never parsed for a `Sources` or `Источники` section,
and the default `sources.legacy.parseAssistantSourcesBlock` remains `false`.

## Deployment steps

1. Keep the QA agent's existing read-only retrieval tools in
   `lockdown.toolPolicy.allow`.
2. Leave `sources.collect.persistTurnEvent: true` so completed turns append a
   replayable `qa/sources` snapshot.
3. Remove prompt instructions that ask the assistant to manually write a
   bibliography. The plugin contributes its own scoped guidance after QA
   attestation.
4. For an opaque subagent provider, expose the inherited
   `qa_report_sources` tool and ask the provider to call it before completion.
   Local DSH subagents require no reporting prompt.
5. Start with `sources.display.showDiscovered: false`; enable it only for
   provenance debugging.

Historical sessions without `qa/sources` remain readable: the Host reconstructs
bundles from durable structured tool metadata when available. Historical
assistant-authored source prose remains ordinary answer text and is not trusted
as provenance.

The `qa/sources` event is a required plugin-owned session event. Keep
`dsh-qa-surface` loaded in any Host that restores sessions containing it.
