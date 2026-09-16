---
"@yadsh/dsh-qa-surface": patch
---

Never pin a tool the session cannot resolve. With the sources fallback on, the
admission appended `qa_report_sources` — this plugin's own provenance reporter —
to the session's tool policy. On a deployment that enables the fallback but does
not mount the tool, that name failed the mount check and refused every chat with
`unknown-tools`, the same way an agent-local name in a mask did. The append now
passes the same mount test as every configured name: where the reporter is
mounted nothing changes, and where it is not, the delegation fallback is what
gives way instead of the whole chat, with one `sources.report-tool-unmounted`
warning in the operator log.
