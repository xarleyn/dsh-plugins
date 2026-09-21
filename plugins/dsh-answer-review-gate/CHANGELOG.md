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