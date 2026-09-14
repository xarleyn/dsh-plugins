---
"@yadsh/dsh-qa-surface": minor
---

Give the QA agent documents instead of command lines. Four tools —
`document_create`, `document_to_markdown`, `document_convert` and
`document_inspect` — sit on top of a document pipeline that owns every backend
invocation itself: the model supplies Markdown, a template name and formats and
receives DOCX and/or PDF, or hands over a DOCX/PDF and receives Markdown with
its images extracted. Markdown is the canonical source, so the artifact bundle
keeps the source, the assets, the produced files and a manifest recording the
input hash, the template hash, the backend versions and every warning.

The agent cannot reach the converters. As in the git tools, the command line is
built by the orchestrator and never by the caller: there is no parameter for a
Lua filter, a resource path or a PDF engine option, remote image references are
refused rather than fetched, paths are resolved and checked against the session
workspace before anything is opened, `.docm` files and encrypted PDFs are
refused with their own codes, and the backends run with a filtered environment
so ambient secrets and proxies do not reach them.

Nothing is registered until a deployment wants it: the plugin registers the
tools when `documents.enabled` is true (the default) and a QA chat still sees
them only if the deployment lists their names in `lockdown.toolPolicy.allow`.
Pandoc and headless LibreOffice are assumed to exist where the plugin runs
(a missing executable answers `BACKEND_UNAVAILABLE`), docling-serve is the
extractor and defaults to `http://docling:5001`, and Typst and MarkItDown stay
disabled until a deployment enables them. A second format that fails no longer
discards the first: partial success is returned with a `FORMAT_FAILED` warning
and the failed file named. Artifacts live under
`<session workspace>/.qa/artifacts/documents/<id>` — inside the per-user
workspace when accounts are on — or in a pinned `documents.storage.root`, where
retention also works. The settings card gains a «Документы» section for the
endpoint, the template root, the artifact root and the default choices.
