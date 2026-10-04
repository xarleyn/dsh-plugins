---
"@yadsh/dsh-qa-surface": minor
---

An answer now says where its facts came from, and the chat history is reachable
on a phone again.

The sources a reader can click are the difference between a claim and a check.
A report filed by the agent that answered — as opposed to one delegated to a
subagent — was being turned away silently: the channel asked who was reporting
instead of whether the entry carried an address, so every such report recorded
nothing and the Sources tab stayed empty on a stand where the conversation's own
agent does the reading. Reports from the answering agent now land in the turn
that made them, and the per-entry rule that a source must name a file or a URL
still applies to each entry.

On a phone the surface hid its sidebar and, with it, the only controls that
could show it again: the history, the search field and «Новый чат» were
unreachable, and the header offered nothing in their place. There is now an
opener in the header, sized for a thumb, and the history slides in as a drawer
over a dimming layer — closed by Escape, by a tap outside, or by choosing a
chat. The drawer leaves the desktop layout's collapsed state alone, so going
back to a wide screen restores what the reader left there.
