---
"@yadsh/dsh-domain-experts": patch
---

The degradation codes a run records are documented one by one, with what each of them costs the expert.

`TOOL_UNVERIFIED` is the code an operator meets on every deployment: the resolver grades an allow-list name as unverifiable whenever it is neither a plugin alias nor a registered worker of this plugin, which is the case for an ordinary tool such as `read` or `grep`. It had no description anywhere, so a `degraded` chip or a `domain-expert/degraded` warning sitting next to `status="completed"` read as a fault in a run that had finished normally.

SPEC §2 now carries a table: for each of the six codes, when it is emitted and what the expert loses. `TOOL_UNVERIFIED` loses nothing — the name is passed to the harness unchanged and stays in the child's tool filter, which the resolution test now asserts next to the code. `TOOL_UNFILTERABLE` is the code that can name a tool the expert did not get, and it names that tool. The informational status is a property of the resolution, not an oversight: this plugin's worker registry is not the host's global tool registry and no seam asks the latter before the child starts, so the resolver can neither confirm nor deny such a name and says so instead of quietly dropping it and narrowing the expert.

The operator-facing half is in the README, all three languages, in the section that already separates `enforced` from `advisory`: the chip is not a broken expert and the codes are not equally severe. `docs/architecture.md` records the same trade-off where the tool mask is described. The machine-readable half — a severity carried by the degradation record rather than read off this table — would change the `DomainDegradation` contract and every surface that reads it, so it is written into SPEC §4 as deferred and the published contract is untouched.
