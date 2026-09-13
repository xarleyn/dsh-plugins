---
"@yadsh/dsh-qa-surface": patch
---

Reorganize the plugin sources without behavior changes. The settings card
sections, the config resolver, the accounts store, and the QA surface split
into per-domain modules: one file per card section, one resolver per config
domain, the account token/file/credential layers beside the store facade, and
the header, right-rail hook, prompt staging, and stream publisher extracted
from the surface and the session controller. The repeated browser storage-key
derivation and the base64 helper moved into shared modules. Public exports,
wire contracts, storage keys, and timing semantics are unchanged.
