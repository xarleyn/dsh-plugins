---
"@yadsh/dsh-qa-surface": minor
---

The `/qa` surface can change its own theme.

Light, dark and follow-the-system were the application's choice only: the Host
publishes its Appearance row inside the settings, and the QA overlay is exactly
the thing that suppresses the host shell — so on `/qa` there was nothing to
click, and a stand opened in a palette nobody had picked. The surface now
carries the three preferences itself, as an icon control in the header next to
the role it belongs to.

The choice is the browser's, not the deployment's. It is written to this
stand's own localStorage namespace and never to the Host user-settings document,
because a stand is shared by everyone who opens it and one visitor's eyes are
not a configuration. A browser that never touched the control stores nothing and
writes nothing at all — the stand keeps the palette the application booted it
in, and the control reports the palette on screen instead of claiming a
preference nobody picked — so the default deployment looks exactly as it did.

What the control writes is the Host's own palette contract: `color-scheme` on
the root and the dark-palette attribute on the body, the two fields the Host
theme presenter owns. That is why the whole surface follows — the plugin cards,
the transcript and the dialogs are built from `--dsw-alias-*` tokens, and those
tokens are declared under precisely those two selectors. The Host publishes its
preference nowhere in the DOM, only the resolved palette, so the surface keeps
the font-size axis and a theme's own token overrides to the Host. `system`
resolves through the OS and keeps listening, so a laptop that goes dark at dusk
takes the chat with it.

While the surface is on screen the choice owns the document; when it stops being
what the visitor sees — the route changing inside the application, or the
overlay unmounting — the palette the document wore is put back. That is the
point of handing it over: off its own route the control is not on screen to
undo itself, and a harness left in a QA stand's palette would stay in it for the
rest of the visit.

While the surface owns the row, the header no longer overflows on a phone: the
title, the role, the palette and the action cluster now wrap instead of pushing
«Настройки» past the clipped edge.
