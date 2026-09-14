---
"@yadsh/dsh-qa-surface": patch
---

Restore the account settings dialog's visual quality. The dialog renders
outside the `.dsh-qa-surface` element, so none of the `--dsh-qa-*` custom
properties reached it: the backdrop never dimmed and the primary Save button
lost its brand fill. The brand tokens now ride the `.dsh-qa-modal` root as
well, and the border-box reset covers its subtree, so full-width fields with
horizontal padding no longer grow past their column and run under the modal's
right border.

The panel drops from a fixed 920x680 to 840 wide and hugs its content up to
the capped height, each page gains a title, and the form actions become a
full-bleed footer strip (sticky within the scrolling content) so Save is
always visible, matching the compact profile modal this dialog replaced.
