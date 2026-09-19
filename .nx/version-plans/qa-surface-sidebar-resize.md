---
"@yadsh/dsh-qa-surface": minor
---

The chat-list sidebar is resizable, and both widths survive a reload.

The sidebar has been a fixed 264 pixels since it first shipped: on a wide
monitor the conversation swallowed the difference, and a reader with long chat
titles — or long owner names in the admin grouping — had no way to trade
conversation width for list width.

The sidebar now drags like the Host frame's own. An invisible 8px strip
straddles the sidebar's right border, the cursor alone advertises it, and a
pointer-captured, rAF-throttled drag moves the edge live. The clamp copies the
frame's constants: the old fixed width is the floor (264), the frame's ceiling
the max (420), with integer rounding and no snapping. The collapsed rail keeps
its fixed width and renders no strip, and expanding restores the last dragged
width.

The chosen width is remembered per browser, in the deployment's localStorage
namespace next to the collapsed flag and the transcript width, so a reload, a
re-login or a reopened tab comes back at the dragged width. During the drag
the width travels through a CSS custom property on the nav element rather than
React state, so the memoized sidebar does not re-render per frame; the
conversation column follows through the ResizeObserver that already
republishes the content width, and that width's existing floor keeps the
transcript readable. Below 600px the sidebar is hidden, as before, and the
strip hides with it.
