---
"@yadsh/dsh-web-fetch-authenticated": minor
---

Serve the Confluence page links Confluence itself hands out. A rule with the
Confluence adapter now recognizes `<context>/pages/viewpage.action?pageId=<id>`
— the URL in the browser bar and in every "copy link" action — plus its legacy
`?spaceKey=<key>&title=<title>` form, and resolves them through the same REST
API as the `/pages/<id>/…` and `/display/<SPACE>/<Title>` forms. Until now only
those two path shapes were recognized, so a page opened through a view-page
link fell through to raw HTTP/HTML and the model received the whole wiki page:
masthead, space menus, breadcrumbs, page tools, comment box, and the Atlassian
footer, with the actual article buried in the middle. Whether a URL is served
by the adapter is now decided by the one function that reads page references,
so the route and the conversion can no longer drift apart.

Give Confluence rules a `cleanup` level and stop the adapter from burying page
content in macro noise. Layout macros (`section`, `column`, `div`) used to be
reported as one placeholder line that flattened everything they wrapped into a
single paragraph; they now unwrap, so the headings, paragraphs, lists, and
tables inside keep their block structure. Task lists become `- [x]` checkboxes,
status badges keep their label, panels keep their callout, a bare user mention
reads `@user` instead of leaving the sentence that introduced it dangling, and
list items and table rows stay in one block instead of being separated by blank
lines (which broke Markdown tables).

What survives beside that content is now the rule's choice:
`adapter.cleanup` is `off` (keep every `_[macro: …]_` and `_[file.png]_` marker),
`balanced` (the default — navigation and aggregation macros are dropped, links,
attachments, and emoticons stay), or `strict` (readable content only, no
markers). The rule editor exposes it as "Page cleanup" next to the adapter
type; an omitted value resolves to `balanced`. The configuration warning for
two rules that can match the same URL now names the shared scheme, host, and
port instead of only naming the rules, and the overlap check no longer reports
two rules that restrict themselves to disjoint ports.
