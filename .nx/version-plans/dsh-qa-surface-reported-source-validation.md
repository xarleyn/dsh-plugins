---
"@yadsh/dsh-qa-surface": minor
---

Let a deployment record sources the model reports as facts. A source reaches a
turn either from a tool call the surface observed or from the `qa_report_sources`
tool, and the second channel refused more than it looked like it did. Only a
delegated run could report at all, so the QA agent reaching for the tool itself
was answered with `Recorded 0 source(s)`; and every entry needed a path or a URL
that survived normalization, so a source describing a fact — the kind `other`,
a title, a snippet, a note that it came from the user's profile rather than from
a search — was dropped even inside a run.

The new `sources.subagents.validateReportedSources` flag (default true, so the
shipped behaviour does not change) turns both checks off. A report from the QA
agent lands in that session's current turn, exactly where a tool-derived source
of the same turn would, and an unaddressed entry keeps the type, title and
snippet the model wrote under the identity `reported:<kind>:<title>`. A URL the
normalizer cannot parse is kept verbatim instead of discarded, and a missing
title falls back to the last path or URL segment. An entry with neither a title
nor an address is still dropped: there would be nothing to render in the source
panel, and the file-preview capability still follows a path alone.

The switch ships as a toggle in the settings card's «Источники» section, under
«Субагенты», beside the report channel it governs.
