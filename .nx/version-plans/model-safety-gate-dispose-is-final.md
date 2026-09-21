---
"@yadsh/dsh-model-safety-gate": patch
---

A disposed gate stays disposed, even when its services resolve late.

`ctx.inject` resolves whenever the service appears — and a service can appear
while the host is tearing the plugin down. Both injections ignored that: the
tool runtime's callback pushed its two listeners into a disposer list that had
already been emptied, so a reload left a gate deciding behind a plugin that no
longer existed, and the settings provider's callback installed a namespace whose
card would edit a gate that was gone. The same shape sat in `reapply`: a
committed settings change arriving after disposal rebuilt the pipeline and
re-opened a logger that had already been closed.

Disposal is now a one-way door: the tool injection, the settings installation
and the configuration rebuild each answer a disposed service by doing nothing.
