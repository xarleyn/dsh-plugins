---
"@yadsh/dsh-qa-surface": patch
---

The settings card test reaches the session section through its own hook.

One case in `qa-settings-card-sections.test.tsx` asked `section()` for «Сессия»
— the caption an operator reads — while the helper takes a `data-testid`, and
the section's test id has been `qa-settings-session` since the card named its
markup. The lookup therefore found nothing and the case failed. It asked for the
request-ceiling field inside that section, so the assertion it carries — the
field's `max` must equal the number `QA_MAX_ACTIVE_REQUESTS_MAX` the Host
validator enforces — never ran.

The assertion itself is untouched: it still quotes the validator's constant
rather than repeating a number, which is the half of the deal that keeps the
card and the Host schema from drifting apart. No source of the package changed,
so no release note is added.
