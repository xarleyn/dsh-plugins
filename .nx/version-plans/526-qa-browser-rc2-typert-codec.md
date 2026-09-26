---
"@yadsh/dsh-qa-browser": patch
---

The browser panel survives a 0.1.7-rc.2 host.

Every call the panel makes to its own `qaBrowser` Remote crosses a typert
boundary, and those boundaries changed shape: a strict codec used to carry the
shared schema as a `schema` field, and now carries a `create` factory that
materialises the schema in the realm that needs it. The panel still handed over
the field, so the host reached a codec with no `create`, and the first
serialised argument — a click, a URL, a screenshot request — threw a `TypeError`
instead of moving. Against an rc.2 host the panel was therefore not merely
typewrong: it did not work.

All seven descriptors now contribute a factory, and the tests that assert the
chrome's own field requirements parse through it the way the runtime does. The
schemas themselves are untouched, so nothing a panel accepts or refuses changed
— the same tab fields, the same mouse buttons, the same click counts. What
changed is that the host can read them.
