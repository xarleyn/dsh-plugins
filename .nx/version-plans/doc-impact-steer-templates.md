---
"@yadsh/dsh-doc-impact": minor
---

The steering messages and the steering itself are operator-configurable.

The reminder the plugin steers into the turn and the final limit notice were
literal strings in the source, so rewording one meant editing the package.
Both texts are now settings: `reminderTemplate` with the `{intro}`, `{count}`,
`{body}` and `{tail}` placeholders (the generated impact list stays `{body}`
and is required), and `limitTemplate` with `{rounds}` and `{impacts}`. An
empty template or one that dropped the required placeholder falls back to the
built-in wording, which reproduces the previous messages exactly, and the
settings card edits both texts in textareas with the placeholders documented
inline.

The new `steer` switch (default `true`) stops the plugin from steering
reminders while everything else keeps working: impacts are still detected and
reported through the tools and `/doc-impact`, reminder rounds are not spent,
and re-enabling starts from a clean slate instead of instantly hitting the
round limit.
