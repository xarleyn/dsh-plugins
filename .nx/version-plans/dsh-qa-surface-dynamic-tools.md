---
"@yadsh/dsh-qa-surface": minor
---

Attach the plugin's QA tools only after the QA skill has been loaded, so the
first request of every chat carries the composition's own tool schemas and
nothing else. Loading the configured skill — by default `qa-surface`, or
whatever `tools.activationSkill` names — is what unlocks the catalog;
`qa_tools_selfcheck` reports the resulting state for the calling agent.

The catalog is registered per agent, so the tools genuinely do not exist for an
agent that has not loaded the skill: no deny-list has to be kept in sync, and a
newly added QA tool cannot leak into a chat that never entered the QA workflow.
Activation follows the authoritative successful result of the built-in `skill`
tool, never the model's attempt or conversation text. Loading an unrelated
skill, a refused or failed load, and a repeat load all leave the tool surface
unchanged, and a registration failure unwinds every tool that attempt
registered rather than leaving a partial surface behind. Registrations live as
long as the agent that owns them, so disposal and plugin unload leave no scoped
tool behind.

A resumed chat gets its catalog back from its own journal before the first
model step: the successful skill load is already recorded there as a standard
tool-call/result pair. The plugin writes no session event of its own — an
unknown event type without an `ignorable` marker makes a log unreadable to a
harness that does not mount this plugin, so the restoration marker stays
derived and a QA session stays openable in a plain DSH deployment.

QA tools cannot be `lockdown.toolPolicy.allow` entries, because that list is
validated against the mounted catalog before activation can run and a tool that
appears only later would fail the check. The QA execution guard therefore
authorizes exactly the names the activation manager reports for the calling
agent, which keeps a dynamically attached tool as checked as an allow-listed
one. Tool visibility is not an authorization boundary.

New configuration under `tools`: `dynamicActivation` (default `true`; `false`
attaches the catalog to every managed agent at creation), `activationSkill`,
`activationMode` (reserved; `all` only), and `activationPresets` — the preset
gate that keeps an unrelated DSH agent from unlocking the same catalog by
loading a skill of the same name.

The shipped catalog contains `qa_tools_selfcheck`. `qa_report_sources` keeps
its existing registration: it is a subagent provenance fallback, and moving it
behind a model-visible skill load would remove it from delegated children.
