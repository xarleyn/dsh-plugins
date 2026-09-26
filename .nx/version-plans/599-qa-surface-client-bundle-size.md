---
"@yadsh/dsh-qa-surface": patch
---

The QA page stops downloading a diagram engine, and the bundle band starts
measuring in CI.

The browser entrypoint is one classic ModuleLoader file: DSH fetches
`/plugins/<package>/client.js`, evaluates it, and never asks that plugin for a
second module, so a client bundle carries its own copy of everything it uses and
`react` is the only thing the shell answers for it
(`docs/ARCHITECTURE.md`, §Host process vs browser client).
Mermaid arrived in 0.13.0 as a plain import of the whole engine, and the artifact
followed it: 239 027 lines and 9.3 MB where the same build measured 66 745 lines
and 2.8 MB without it. Reading the built bundle's own source map names where those
lines come from — mermaid 73 681, cytoscape 35 707, the diagram-language parser
34 060, plus d3, dagre, roughjs and the rest — the tree behind one fence is 72% of
what the QA page downloads before it paints anything.

Neither way out that the size of a bundle usually has is open here. The engine is
not something the shell could provide: none of the `@deepseek-ai/*` client bundles
in the tested matrix contains it, so declaring it external would leave the page
with a `require` nobody answers — which is the 0.13.1 incident. The tarball gate
catches a relative `require("./x")` that resolves to nothing, not a bare one, so
the size band in `check-file-budget.mjs` is what holds this line. And a deferred
chunk is the same unavailable
second file seen from the other end: `codeSplitting: false` is what made the QA
page open again. So the diagram engine leaves the client. A `mermaid` fence
renders as the code block it was before 0.13.0 — an open fence shows what has been
written so far, a closed one shows the source, and both keep the copy control.
KaTeX stays: math is 16 671 source lines against the engine's 172 111, it is what
makes a formula read as a formula, and it is the one third-party tree this surface
can name a reason for. Getting diagrams back is a host question, not a plugin one:
either the shell renders them or the loader learns to fetch a plugin's deferred
module, and until one of those exists the client must not carry the tree.

The second defect is the one that let the first stand for two days.
`pnpm check:files` holds a generated bundle to a runaway line limit, and its own
comment bases that limit on this file — but `lib/` is gitignored and the gate runs
in the `prepare` job, on a checkout that has never been built, so in CI the band
reported `0 generated artifacts` and the line was crossed only because someone
rebuilt locally. The CI workflow now runs the same gate in the project job, right
after that project's build, which is where its bundles exist; the repository
tooling test pins both the step and its position after the build, and
`docs/VERIFICATION.md` says which band measures what where.

Tests: the Mermaid suite pins the fence as source rather than a rendered diagram,
the streaming suite keeps the open-fence case with the renderer's calls removed,
and the curated changelog loses the 0.14.0 entry that promised to fix diagram
re-rendering on every keystroke — the thing it described is gone with the engine.
Verified with `pnpm nx run @yadsh/dsh-qa-surface:check` (lint, typecheck, test,
build, verify) and `pnpm check:files`, which now reports the client at 66 745
lines against the 80 000 warning.
