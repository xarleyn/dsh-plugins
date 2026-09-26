---
"@yadsh/dsh-qa-integrations": patch
---

The rules a provider kept for itself are the kernel's now: one address policy
for every endpoint list, and two named retry budgets instead of a lambda per
transport.

**An address rule that only one provider had.** Test IT refused a `baseUrl`
carrying a fragment; the other six folded one away in silence. A fragment never
reaches the server, so what an operator pastes — the browser URL of the page they
were reading — became an endpoint that meant something else, and the row looked
accepted. The refusal now lives in `providers/kernel/address.ts` beside the
credentials and query rule, with a knob for the one word a provider cannot share:
an installation that legitimately has no certificate is called *internal*, not
*development*, and the operator reading the refusal looks for the word their own
product uses. Confluence, Test IT and Weblate resolve their lists through that
policy now, so their three copies of `normalizeInstance` are gone; the row members
a provider carries beyond the shared shape come from its own `extra`.

**Two retry budgets, named.** The deadline over the whole exchange is the shared
loop's; what a deployment still chooses is whether a request that never answered
is asked again. Jira, TeamCity and Confluence re-send it, so one read can cost
`retries × timeoutMs`; GitLab, Test IT and Weblate hold one `timeoutMs` as the
whole budget. Both rules existed, as an inline lambda in each transport, beside a
comment that in places described the other one — which is how the mismatch
between the words and the behaviour survived review once already.
`DEADLINE_IS_THE_BUDGET` and `RESEND_AFTER_EVERY_FAULT` are now the kernel's two
names for the choice, the default is the shorter one, and a provider either names
its rule or takes the default: three transports no longer restate a predicate, and
three say in the kernel's words which of the two waits the operator gets. What the
choice does *not* cover is pinned too: a body this deployment stopped reading is
the read's own refusal, so neither rule buys it a second attempt, and GitLab
asserting one attempt after a timeout beside Jira asserting the re-send is what
keeps the asymmetry a decision rather than an accident.

The client operator card kept one duplicate through its own split:
`resourceRecord` was defined in `operator-sections/shared.tsx` and again in
`service-profiles.tsx`. The shared one is kept. The kernel contract is now tested
where it is written — `tests/kernel/`, the read-budget cases against a real socket
rather than a hand-built `Response`, because the thing under test is whether an
abort reaches a body still being read — and `scripts/verify-package.mjs` asserts
the address policy and the two named budgets on the kernel, instead of on
whichever provider happened to hold a copy.

What is unchanged: the package's `exports`, the settings slot the card registers
in, and the DOM the operator's tests read. Hence `patch` — no consumer of this
plugin calls anything differently. What an operator can notice is a connect-form
row that refuses a pasted browser URL, and a stalled upstream that costs the
timeout this deployment configured rather than the longer wait its provider's
comment had promised.

**The host side of the same copying.** `src/index.ts` kept the connect card's
plumbing seven times over: each provider restated, in its own body, how a summary
is read, how a credential is spent, how a policy is patched and how a connection
is let go. Those bodies are the composition root's helpers now and a provider
names its id to them, so the acceptance the kernel was written for holds on the
host side too: a new provider adds its own module, its row in the endpoint list
and its thin remote methods, without re-writing the rules beside them. The list of
names the package publishes moved out of the composition root into
`public-api.ts`, re-exported by the entry, so the file answering «what does this
deployment mount» no longer also answers «what may another plugin import»;
`verify-package.mjs` asserts the entry keeps carrying that surface. The
composition root went from 1537 lines to 1052 and left the budget allowlist, which
is the list that only shrinks. The 49 `@Remote` members keep their names and
parameter shapes, so the generated client is untouched.
