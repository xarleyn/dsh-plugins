---
"@yadsh/dsh-preset-persona-editor": patch
---

A preset row breaks its own text where the text is actually drawn.

A long persona name used to push the state badge across the row's description at
phone width. The word break now sits on the element the roster renders, so the
name and description wrap inside the row and the badge keeps its place; the guard
renders the roster screen and asks for the row's own description, so a sheet that
loses the break and a row that leaves the carrying element each fail on their own.
