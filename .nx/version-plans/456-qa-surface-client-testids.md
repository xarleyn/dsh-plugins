---
"@yadsh/dsh-qa-surface": patch
---

The `/qa` surface names the parts of its own chrome, so a browser test can point
at a node instead of at the Russian words beside it.

Sidebar, header, right rail, agents panel, workspace browser, work group, dialog
shell, auth gate and the welcome notice were all reachable through their BEM
classes or the visible label — and several of them repeat one class across every
row, tab and entry, so a check had to match a caption or a modifier to find the
node it meant. A reworded label, or a renamed class, broke such a check while
nothing was actually wrong with the surface. Each zone now says what it is:
`sidebar-*` and `sidebar-resize` for the chat history and its handle,
`header-*` and `subagent-banner-*` for the chrome above the transcript,
`rail-*` for the sources and files panel, `agents-*` for the subagent list,
`workspace-*` for the file browser and its preview, `work-*` for the turn's
reasoning and tool rows, `modal-*` for the shared dialog shell, `auth-*` for the
sign-in card, `welcome-*` for the disclosure and `width-handle-*` for the two
content handles. The values are ASCII kebab-case and unique in the package;
where a zone repeats — a row per chat, a tab per panel, a handle per side — the
recurring parts share one id and the side-specific ones carry their discriminator.

Nothing else moved: no class, no attribute the reader sees, no layout — only the
test attribute. The surface's own tests reach those nodes by id now and keep
asserting every control through its role or accessible name.
