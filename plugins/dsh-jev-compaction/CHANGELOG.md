## 0.1.1 (2026-09-22)

### 🩹 Fixes

- A missing-credential key stays one key, and the file stays text. ([0a70f14](https://github.com/xarleyn/dsh-plugins/commit/0a70f14))

  The dedupe key for "this provider has no credential configured" joined the
  provider and the variable name with a literal NUL byte, which made git treat
  `service.ts` as binary — no diff, no review — and the separator is now written
  as an escape. The key a running plugin compares is unchanged, so a deployment
  that already reported the missing variable once still reports it once.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.0 (2026-09-21)

### 🚀 Features

- New plugin: Jev-powered, replay-safe semantic pruning of stale tool results. On `agent/pre-step` — at a configurable context pressure — historical `tool/result` surface nodes are scored by the Jev decision model and replaced through replay-safe single-node replacements (truncated head/tail or a neutral stub), while conversation text stays verbatim and the original full results remain in the append-only session log. Includes `/jev-compact` and `/jev-compact --dry-run` commands, automatic pressure triggering with cooldown and a minimum-savings gate, strict response validation with fail-open behavior, a fake decision backend for tests, and decision-endpoint presets (TypeSafe System One, a local System One-compatible server, or a custom endpoint). A `./backend` entry extends `BasicCompactionEngine` to provide the `ctx.compaction` service itself — semantic pruning runs at the early threshold and the conventional summary above `summaryRatio` — while `/compact` and overflow recovery keep working through the official seam. Ships a twelve-scenario offline evaluation corpus (`pnpm run eval`) with a zero-dangerous-prune release gate. ([b69409f](https://github.com/xarleyn/dsh-plugins/commit/b69409f))
- Immediate result shaping and a real settings card. On the `tools/post-execute` waterfall — before DSH persists the final `tool/result` — large repetitive command output is reduced to the lines that still matter: the text is segmented into line shapes, the head, tail, conclusions, failures and diagnostics are pinned, contiguous repetitive runs are classified by Jev with two questions ("is this routine repetition", "would removing it materially hurt the next decision"), and a run collapses only when both answers are decisively apart. Shaped text keeps its original ordering and is marked with neutral facts ("collapsed 97 repetitive lines"), never a claim that the output was irrelevant. The layer is opt-in and off by default, leaves errors untouched, skips results another layer already bounded, preserves every other post-execute decision (blocks, value replacements, additionalContexts), and fails open on timeout, transport error or cancellation. ([eca8de0](https://github.com/xarleyn/dsh-plugins/commit/eca8de0))

  Because shaping happens before persistence, the original rendered result is not recoverable from session replay; a content-addressed archive (sha256, deduplicated, retention window and size ceiling) keeps it by default, and turning the archive off while shaping is on is answered with a visible warning rather than silence. Historical compaction recognizes already-shaped results, leaves their markers alone, and carries the archive reference into a later stub.

  The plugin also gains a first-class settings card: **Settings → Plugins → Jev Compaction** edits the plugin's `jev-compaction` namespace through the host settings service — enable/disable, the shaping thresholds and tool allow/deny lists, the archive policy, the historical thresholds and the decision endpoint — applying to the running plugin without a restart and marking which values the user layer overrides. The card never receives an API key: it edits the name of the environment variable holding it. Configuration is documented in full in `docs/configuration.md`, and the API findings behind the layer are recorded in `docs/RESULT_SHAPING_SPIKE.md`.


### 🩹 Fixes

- A self-hosted backend is reached again, and an unset key is reported at startup. ([503cbc3](https://github.com/xarleyn/dsh-plugins/commit/503cbc3))

  `decision.<provider>` — the shape the README documents and the profiles use —
  was shadowed by the legacy flat `jev` block. The settings service hands the
  resolver a configuration with every shipped default filled in, so that block
  was always present, and `resolveEndpoint` let it win over the provider: a
  deployment configured for a local System One server on `decision.jeff.*` asked
  for `TYPESAFE_API_KEY` and refused every prune with "is not configured" before
  a single request left the host, while the local scorer sat idle. The legacy
  block is now an override only for values that differ from the shipped defaults,
  so it still serves deployments that wrote it and stops shadowing the provider
  they selected.

  Two smaller things around the same failure: a base URL that names only a host
  (`http://jeff:8000`, which is what the preset, the README and a deployment's
  own row said) is completed with the `/v1/systemone` route the System One
  contract defines — the client POSTs to the configured URL as it stands, so a
  bare host used to answer `404 Not Found`; and a backend whose key variable is
  empty at startup is reported once in the plugin log
  (`jev-compaction/credential-missing`, with the provider, the variable and the
  endpoint), because the environment is not part of the configuration and the
  first symptom would otherwise be a prune refused minutes later. The refusal
  itself now names the backend and the endpoint it tried to reach.

### ❤️ Thank You

- xarleyn @xarleyn