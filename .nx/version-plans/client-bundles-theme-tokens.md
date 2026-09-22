---
"@yadsh/dsh-doc-impact": patch
"@yadsh/dsh-documents": patch
"@yadsh/dsh-domain-experts": patch
"@yadsh/dsh-draft-sessions": patch
"@yadsh/dsh-qa-browser": patch
---

Five client bundles stop letting a literal decide a surface, a status or an
elevation (#254).

The audited rule is the one the guidelines state: UI is built from
`--dsw-alias-*` tokens, and a literal may only carry a narrow semantic accent.
Outside `dsh-qa-surface` (excluded by the card), the sweep found two statuses
and two elevations that broke it:

- `dsh-domain-experts` defined its own `--dx-ok/--dx-warn/--dx-danger` with hex
  literals, so enforced, advisory and error text kept a fixed green, amber and
  red in every theme. They now resolve to the host's
  `--dsw-alias-state-{success,warn,error}-primary`, which the rest of the
  repository already uses; the local names stay, so no rule changed shape.
- `dsh-qa-browser`'s canvas and its tab menu carried literal `box-shadow`
  values. They now ask for `--dsw-shadow-lv2`/`--dsw-shadow-lv3` - the tokens
  `dsh-qa-surface` and `dsh-draft-sessions` already use - and keep the previous
  value as the fallback, so an older host renders exactly as before.
- `dsh-draft-sessions` wrote the same idea as `--dsw-shadow-l2`, a name no host
  defines; the literal fallback hid it, which is why it survived. Corrected to
  `--dsw-shadow-lv2`.
- `dsh-documents` asked for `--dsw-label-tertiary` first and only fell back to
  the token that exists; the dead first name is gone.
- `dsh-doc-impact`'s transparent button border was spelled `#0000`; the keyword
  `transparent` says the same thing without a color literal.

What stayed is what the rule allows: the remaining literals in these bundles are
all fallbacks inside `var(<token>, <literal>)`, never the value a themed host
would resolve. Typography literals were deliberately not touched - the canonical
card shell in AGENTS.md hardcodes its own 15/13/11px sizes, so font sizes are
the repository's convention rather than a token-governed surface.
