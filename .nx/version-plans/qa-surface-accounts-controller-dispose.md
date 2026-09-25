---
"@yadsh/dsh-qa-surface": patch
---

A signed-in chat stops falling back to the sign-in card on its own.

The browser half of the surface rebuilds its account controller whenever the
remote wiring re-injects, and the boot `whoami` of the instance being replaced is
still in flight at that moment. Its answer used to arrive in a controller that
nothing had ever unloaded: a definite "not authenticated" cleared the stored
token under the shared `<storageKey>:v1:<route>:account-token` key — the very key
the fresh instance had just written its login to. The browser then showed the
sign-in card over a session it had actually kept, and asked for the password
again. No account data was lost.

The controllers teardown effect now unloads the account controller alongside the
config and route controllers, as every other controller of the module already
was, so the late answer stops at the `disposed` guard instead of reaching
storage. The race is pinned at the level it lives on: the client module is
loaded, unloaded and loaded again under a Cordis context, and the assertion is
about what the second instance stored. That test fails on the previous sources,
where the token comes back erased.
