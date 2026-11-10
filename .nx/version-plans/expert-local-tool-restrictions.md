---
"@yadsh/dsh-domain-experts": patch
---

Accept tool policy entries supplied by the child's own preset without passing
them to the inherited-tool mask. Preserve native restrictions for inherited
tools and apply explicit denials to local and later registered tools through
the scoped execution guard. Unknown allowed tools still refuse the child.
