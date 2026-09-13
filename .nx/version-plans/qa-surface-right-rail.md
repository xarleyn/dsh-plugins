---
"@yadsh/dsh-qa-surface": minor
---

The sources drawer becomes a collapsible right rail with tabs, mirroring the
Harness right Sidebar's interaction pattern (a tab strip is the panel's whole
top edge). The rail hosts «Источники» — the same grouped list and safe
file-preview the drawer rendered, with a message footnote still opening it
pinned to that answer's subset and a new «Все источники» way back — and a new
«Файлы» tab: every attachment the visitor sent in this chat, grouped by
message and ordered newest first, with file cards (badge, name, size) and
image thumbnails resolved through the session's asset repository. Each group
jumps back to its message in the transcript. The header gains a «Файлы»
button with a live count; the agents drawer keeps its behavior and closes
when the rail opens. Below 600px the rail goes full-bleed like the drawers
did.

The Host mechanism for right-sidebar tabs was deliberately not used: the QA
page is a full-frame overlay painted over the Host shell, so the Host's own
right column stays invisible and unreachable behind it while `/qa` is active.
