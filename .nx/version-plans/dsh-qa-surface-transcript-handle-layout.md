---
"@yadsh/dsh-qa-surface": patch
---

Keep the transcript's drag handles off the answer. The width handles claim a
40px strip just outside the text column, and the break-out that let code blocks
and wide tables use the page gutter was measured against the browser viewport
instead of the chat column — with a side panel or drawer open it overshot both
the column and the strip, so the handle (and its drag glow) painted on top of
tables and code. The gutter is now measured from the live column the way the
handles are, the break-out is capped eight pixels short of the strip and is
zeroed on the phone layout where the handles are hidden, and tables no longer
break out at all: they sit in the text column, sized to their content instead
of stretched to the column width, with per-cell ceilings computed from the chat
width so a long column wraps rather than inflating the table — anything wider
than the column scrolls inside its own frame.
