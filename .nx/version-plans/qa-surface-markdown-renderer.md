---
"@yadsh/dsh-qa-surface": patch
---

Render assistant Markdown with the transcript's own grammar and typography
instead of a hand-rolled subset.

The renderer recognized `#`-through-`###` only, so a model that wrote a
`####` sub-heading — the shape every MR review answer uses for its numbered
sections — got its hashes painted as literal text. Below that it had no nested
lists, no task checkboxes, no images, no reference links, no autolinks, no
strikethrough, no setext headings, and it turned every soft line break into a
hard one. A fence rendered as a bare `pre`: no language banner, no syntax
color, and long code sat in a box whose styling shared nothing with the chat
transcript next to it, while the surface's own theme tokens for Markdown sat
unused.

The block and inline grammars now live in `src/client/markdown/`, and the
stylesheet reads the same custom properties DSH's transcript reads:
`--dsw-font-markdown-*` for the size ladder (headings, body, tables, inline and
block code, all following the user's font-size preference and the 0.875 scale),
`--dsw-alias-markdown-*` for code surfaces, and `--shiki-token-*` for the
syntax palette — so light, dark, and a re-branded theme all move together with
the host. Raw HTML still never reaches the DOM, link and image destinations
keep their protocol allowlist, and a path or link the message knows as a source
still renders as a source chip.

A fence now renders as the code card the transcript uses: a sticky-height
banner naming the language, a copy button, and a small built-in highlighter
(comments, strings, numbers, keywords, keys, markup, diff roles) for the
languages answers use. That highlighter is ours rather than shiki's: shiki's
grammar set alone is ~1.6 MB, which the self-contained client bundle cannot
carry, so the scanner covers the shapes that carry meaning and renders any
other language as plain monospace. The whole change costs the bundle ~50 KB.
