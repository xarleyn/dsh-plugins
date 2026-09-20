---
"@yadsh/dsh-documents": minor
---

Sibling host plugins can convert and extract through this plugin's pipeline.

The tools were the only surface: a plugin that needed a document rendered had
to stand up a second runtime with its own provider registry, semaphores and
limits, or shell out to the same binaries behind the pipeline's back. `apply()`
now publishes the installed subsystem as the `documents` service
(`toMarkdown`, `convert`, `inspect`), and each callback reads the live runtime
at call time, so a configuration reload that rebuilds the subsystem cannot
leave a caller holding a disposed one. Nothing new is reachable from a browser —
the service lives in the host process, and the package still ships no Typert
face — and a deployment that disabled the pipeline publishes nothing at all, so
the absence stays a refusal rather than a silent second converter.
