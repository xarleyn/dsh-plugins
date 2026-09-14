# Structured sources migration

`dsh-qa-surface` now treats `QaTurnSources` as the only canonical provenance
model. Assistant prose is never parsed for a `Sources` or `Источники` section,
and the default `sources.legacy.parseAssistantSourcesBlock` remains `false`.

## Deployment steps

1. Keep the QA agent's existing read-only retrieval tools in
   `lockdown.toolPolicy.allow`.
2. Leave `sources.collect.persistTurnEvent: true` so completed turns write a
   replayable snapshot to `$DSH_HOME/qa-sources.json`.
3. Remove prompt instructions that ask the assistant to manually write a
   bibliography. After QA attestation the plugin contributes its own note,
   which rides the conversation rather than the system prompt.
4. For an opaque subagent provider, expose the inherited
   `qa_report_sources` tool and ask the provider to call it before completion.
   Local DSH subagents require no reporting prompt.
5. Start with `sources.display.showDiscovered: false`; enable it only for
   provenance debugging.

Historical sessions without a plugin-owned snapshot remain readable: the Host
reconstructs bundles from durable structured tool metadata when available.
Historical assistant-authored source prose remains ordinary answer text and is
not trusted as provenance.

Releases before this migration wrote `qa/sources` into the Harness session
journal. Stop DSH, run `qa-repair-sessions` to preview affected logs, then run
`qa-repair-sessions --write`. The command preserves those records, marks only
the known plugin records ignorable, and creates a backup before replacement.
