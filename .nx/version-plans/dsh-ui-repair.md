---
"@yadsh/dsh-ui-repair": patch
---

Initial release: conservative DOM diagnostics and scoped repairs for DeepSeek
Harness plugin UIs. Semantic repair roots replace coupling to hashed
CSS-module classes; R001 repeated-row icon alignment, R006 unexpected vertical
overflow, and R007 clipped-content diagnostics run in `observe`, `suggest`,
and conservative `auto` modes with animation-frame layout stabilization,
verification, and rollback. Allowlisted CSS writes stay scoped by per-repair
data attributes, bounded initial scans gain mutation-triggered targeted
rescans, repair history stays in memory, and every owned attribute and style
tag is restored on unload.
