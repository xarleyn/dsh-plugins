---
"@yadsh/dsh-answer-review-gate": patch
"@yadsh/dsh-qa-surface": patch
---

A reviewer can no longer ask to delete a file, and a delegated call is refused
where it asks instead of stopping the turn.

The gate's own child is now composed from an explicit read-only set
(`src/reviewer-tools.ts`): unset `reviewer.allowedTools` means reads and
searches rather than nothing, and the destructive names — `file_delete`, the
file-writing and shell tools, the catalog's own delete, and any `terminal_*` or
`job_*` tool — are removed both when the config is resolved and again at the
call that starts the child. The reviewer's two task texts say the same thing
the filter enforces: an obstacle is a finding about the candidate, not something
to clear. On the `domain-expert` branch the mask is the domain's and a tool the
surface attaches to the agent's own layer survives any inherited filter, so that
branch is held on the surface's side.

There the approval seam refuses a delegated child's request outright, in either
`interaction.approvals` mode: a card parked over the parent's composer waits for
an answer a child can never be given, which is how a stand came to look like it
was thinking for an hour over a yes/no about one tool call. `file_delete` from a
delegated call is refused by its own inner gate too, with a reason that tells the
caller to report the file rather than remove it, and a parked request an operator
never answers now expires into a refusal instead of holding the turn open.
