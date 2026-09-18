---
"@yadsh/dsh-qa-surface": patch
---

A failed personal-skills listing no longer hides the whole skill catalog.

The discovery provider is one voice in the harness skill registry, and the registry treats a throwing provider as an incomplete snapshot: the model-facing available-skills section is withheld in full, for every session, together with the plugin-provided and file-based skills. One account hitting a racy filesystem error on its own `.dsh/skills` directory — an access denied, a share violation mid-read — was enough to answer `SKILL_NOT_AVAILABLE` for every skill name on the stand.

`discover` now degrades to "no personal skills read" for that account and logs the reason as `skill.discover-failed`, so the rest of the catalog keeps publishing. The editor paths are unchanged: they still surface diagnostics loudly, because there a refusal is the feature.
