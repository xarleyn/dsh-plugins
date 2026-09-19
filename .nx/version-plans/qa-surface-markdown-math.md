---
"@yadsh/dsh-qa-surface": minor
---

Assistant Markdown renders TeX math and footnotes the way the DSH transcript
does.

The chat renderer stopped at the GFM grammar: answers that write formulas in
TeX — inline `$x^2$`, display blocks between `$$` fences, ```math fences —
showed up as raw source with backslashes and braces, and a footnote reference
`[^1]` stayed visible bracket text while its definition rendered as an
ordinary paragraph.

Math now renders through the same library the transcript uses (KaTeX, display
and inline mode), so fractions, subscripts, Greek letters and integrals read
as formulas. The delimiter shapes follow the transcript's settled grammar
exactly — maximal-munch dollar runs, equal-length opener and closer, padding
stripped only when both ends carry it, unpaired dollars (prices) staying
literal — and the `\(…\)` / `\[…\]` delimiters stay literal text there too,
so both surfaces agree on what is a formula. Footnotes follow GitHub's
dialect: a defined `[^label]` renders as a numbered superscript and the
definitions collect into a trailing section with per-reference back-markers,
while an undefined label stays literal text.

KaTeX joins the self-contained client bundle deliberately: the stylesheet and
all twenty woff2 faces travel inside the bundle as data URIs, so math looks
right whatever the Host page loads, and the generated
`src/client/markdown/katex-css.ts` is refreshed by
`scripts/generate-katex-css.mjs` on dependency bumps.
