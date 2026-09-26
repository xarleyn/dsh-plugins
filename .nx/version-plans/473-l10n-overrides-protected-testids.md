---
"@yadsh/dsh-l10n-overrides": patch
---

The protected-surface table now names the harness-owned surfaces by the stable
`data-testid` epic #453 gave them, instead of only guessing from a class name.

A surface that holds someone else's text — a rendered Markdown block, a quoted
source snippet, a line of the log buffer — must never be rewritten by the
translator. Until now it was caught only when its class or test id happened to
read like a conversation buffer, so `qa-md-table`, `qa-md-code` or
`qa-source-detail-snippet` stayed translatable while its own markup says plainly
what it is. Those ids are listed now, the Markdown zone by its prefix, and the
class keywords stay as the fallback for markup that carries no test id yet — the
host's own surfaces among them. Both the selector list and the heuristic that
notices a protection was removed are built from the same tables, so a surface
cannot be protected on one path and missed on the other.

Nothing was widened past the id it names: the table matches a prefix, not a
substring, so a surface that merely looks alike stays translatable, and the
composer keeps its protection only as a test id, because its class is layout.
The package's own checks reached several nodes through a class, which is the
attribute a translation scope is written in and the one the tests themselves
rewrite; those locators moved to `data-testid`, and every assertion on visible
text, on an attribute or on `aria-label` stayed where it was. Only attributes
were added to the fixtures — no element moved, so the markup tests exactly what
it tested before.
