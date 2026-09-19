---
"@yadsh/dsh-qa-surface": minor
---

The ambient model notes are configurable: each can be muted and reworded from
the settings card.

The plugin writes three hidden user messages into a QA chat: who the user is
(name, email, handles, their own instructions), the source-provenance rules,
and the request to give background subagents short vivid names. The texts were
literal in the source, and the only switches were the feature switches around
them (`accounts.profile.inject` gated the identity note; the sources note
disappeared only together with provenance collection itself; the delegation
note had no switch at all).

The new `notes` config block — surfaced as the «Заметки модели» section of the
settings card — gives each note an on/off switch and a wording override:
`notes.identity.template` with `{identity}` and `{instructions}`,
`notes.sources.template` plus a separate `fallbackTemplate` with
`{reportTool}`, and `notes.delegation.template`. An empty template keeps the
built-in text; a template that drops its required placeholder falls back to
the built-in wording instead of silently anonymizing the note. Muting stops
future notes only — one already delivered stays in the conversation it
reached — and notes remain advisory text: the lockdown and tool policy hold
whatever the conversation says.
