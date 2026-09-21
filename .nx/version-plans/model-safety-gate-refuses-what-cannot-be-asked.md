---
"@yadsh/dsh-model-safety-gate": patch
---

A blocked call no longer claims the user rejected it when nobody was asked.

The gate's tool-call guard escalates a call to `ask` when the turn's accumulated
risk demands confirmation. That decision is not the gate's to keep: the tool
runtime resolves it through the `approval` service, and the outcome vocabulary
carries no reason — the runtime writes its own sentence, so a refusal reads
`the user rejected tool "X"` and the categories the gate reported are dropped.
On a session whose effective approval policy is `never` that is the only
possible outcome, decided before any answerer runs.

A locked-down deployment therefore turned every escalation into a phantom human
refusal: the model learned that an operator said no, and never learned which
rule fired. The gate now reads the same policy the approval service reads — the
session's logged override first, else the deployment default — and refuses the
call itself:

```text
Blocked by dsh-model-safety-gate (unsafe_tool_intent): this call needs
confirmation, but the session's approval policy is "never", so the request
could only ever be refused without asking anyone
```

Nothing about the outcome changes: under that policy the runtime's own answer
was the same refusal, decided before any answerer could run. Only the sentence
changes — it now attributes the refusal to the gate and keeps the categories.

The read is deliberately narrow: only a policy the gate actually read can turn
an ask into a refusal, so a host that composes no approval service, a session it
cannot read, and a value outside the published vocabulary all keep the native
ask. `tools.unanswerableAsk: ask` restores that flow for a deployment whose own
gate answers asks ahead of the policy.
