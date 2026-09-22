## 0.1.1 (2026-09-22)

### 🩹 Fixes

- The review round budget and the PASS receipt now belong to the user turn, so a ([f3b1045](https://github.com/xarleyn/dsh-plugins/commit/f3b1045))
  reviewed answer stops being reviewed.

  Both were keyed by the agent turn the boundary reported. Agent turns are not
  user turns: one request spends several of them, because a REVISE steer continues
  the current turn while the primary's next version — or a settlement notice —
  reopens the boundary as a new one. Every such change therefore discarded the
  receipt of a candidate the reviewer had already passed and handed the gate a
  fresh round budget. The result was the reported exchange: the reviewer passed an
  answer, the model wrote one more version announcing the review, and that version
  was reviewed again instead of shipping, with the round limit never reached
  because each turn reset it.

  The gate now keys its session state by the user request the candidate answers —
  the surface sequence of the latest real user message — and keeps the round
  counter, the one-per-turn failure steer and the PASS hash there. The agent turn
  only refreshes the turn number used for delegation bookkeeping. An unchanged
  candidate is never reviewed twice, not even in a later agent turn of the same
  request; a candidate that changes after a PASS is reviewed once, as any changed
  candidate is; and the revision budget is spent by the request, so `open`/`warn`/
  `closed` failure handling takes over after `maxReviewRounds` revisions of that
  request instead of starting over. A new user message owns a new budget and no
  longer inherits the previous request's receipt, while a boundary that finds no
  candidate cannot reset a known budget.

  The reviewer tasks also state the contract that made the loop look reasonable
  from the model's side: a pass is final for the candidate it reviewed, it ships as
  written and asks for no further version.

### ❤️ Thank You

- Codebuff
- xarleyn @xarleyn

## 0.1.0 (2026-09-21)

### 🚀 Features

- New plugin: an independent answer review gate. Before a candidate final answer ([6097585](https://github.com/xarleyn/dsh-plugins/commit/6097585))
  completes its turn, a configurable reviewer (a dsh-domain-experts domain or a
  native subagent child) checks it and can send findings back for a corrected
  candidate within bounded rounds. Interim turns that close while the session's
  background delegations are pending are never reviewed; a review PASS applies
  to the exact candidate content; reviewer failures follow the configured
  failure policy (`open`/`warn`/`closed`) and are never reported as passes.


### 🩹 Fixes

- Independent verification reaches the domain-experts backend again. ([9dc59b0](https://github.com/xarleyn/dsh-plugins/commit/9dc59b0))

  The gate resolved its reviewer service as `ctx.get("domain-experts")` — which
  is the plugin id and the settings namespace, but not the service name: the
  provider registers `ctx.domainExperts`, and its own wiring test pins that key.
  The lookup therefore returned nothing on every deployment, so every answer
  came back with the failure-policy notice — "independent verification could not
  be completed (the dsh-domain-experts service is not loaded)" — while the
  plugin ran in the same process, and the reviewer never ran. The gate now asks
  for the key the provider publishes, and a regression test pins the contract in
  both directions: a service registered as `domainExperts` is used, and the
  plugin-id spelling is not silently accepted as a reviewer backend.

- Both reviewer tasks tell the reviewer not to loop on a failing tool. ([135433f](https://github.com/xarleyn/dsh-plugins/commit/135433f))

  The expert task and the subagent task described what to verify and how to
  report it, but not what a refused, timing-out or unavailable call means. On a
  deployment where one source answers with a timeout and the reviewer's working
  directory is empty, the reviewer spent its budget retrying the same endpoint
  and reading "no matches" from a path-less search as if the corpus were empty.

  Each task now carries the same three rules the expert base policy states: a
  failing call has already answered — record it and change the source or the
  query instead of repeating it; read tools take an explicit path, and a pattern
  without one searches the reviewer's own directory; an unavailable source is
  reported, never guessed. The reviewer still reports what it could not verify,
  so a failed source remains visible in the verdict rather than silently
  absorbed.

### ❤️ Thank You

- xarleyn @xarleyn