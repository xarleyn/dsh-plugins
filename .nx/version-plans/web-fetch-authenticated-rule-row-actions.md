---
"@yadsh/dsh-web-fetch-authenticated": patch
---

The rule row reads as a row of facts, and its four actions are icons with names.

Four text actions — enable/disable, test, edit, delete — plus three status pills
filled the row's whole right-hand side, so a rule with a long origin wrapped onto
a second line. The actions are icon buttons now, each one carrying its label in
`aria-label` and `title` and hiding the glyph from the accessibility tree, so the
row keeps its width without the icon becoming the only thing that says what the
button does; the text-button style the four used is gone with them.

The origin column printed a rule's scheme in full, and a rule that accepts either
scheme spelled both of them (`https/http://jira.example.corp`). The scheme is a
token now: `https://jira.example.corp`, `http://…`, or `http(s)://…` when both
are accepted — the host, which is the part an operator reads, gets the width the
schemes were eating.

The tester report and the provider overview joined their facts with middle dots.
Dots as separators are decoration: they cost a glyph per item and say nothing a
gap does not. Each fact is its own labelled item on a line that separates them by
layout, so the report reads as a list of measured values instead.

The package gate asserts all three: the four actions resolve through the named
icon button, the compact scheme token is in the bundle, and neither a middle-dot
separator nor the old text-button class can come back.
