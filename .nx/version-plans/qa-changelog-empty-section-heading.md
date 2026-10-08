---
"@yadsh/dsh-qa-surface": patch
---

The version history stops drawing a heading for a section that has no entries.

A published entry can carry an empty section — `0.8.0` lists "Новое" with
nothing under it — and that text is frozen by the release that published it, so
the heading is the half that can yield. The dialog now renders only the sections
that have at least one entry, which leaves every published sentence exactly as it
shipped while removing the titled box that read like a changelog that lost its
content.
