---
"@yadsh/dsh-audit-ui": patch
---

The error state's retry button is now asserted through its accessible name.

The rendering test reached the button by tag and position, which keeps passing
after the label is gone or moved and says nothing about how a screen reader or a
role query finds the control. It now asks for `button` by the name `Try again`
in both directions: the state without a retry callback offers no such button,
and the state with one offers exactly that button. A change that leaves the
control unnamed fails the test instead of passing it.
