# SPEC — @yadsh/dsh-model-safety-gate

Independent defense-in-depth safety layer around the DeepSeek Harness agent
loop. A deterministic scanner (L0) plus an isolated small-model classifier (L1)
evaluate user prompts, streamed model output, tool calls, and tool results.
The plugin is an additional decision layer only — it never replaces the DSH
sandbox, permission system, or approval gates.

The full design document with the architecture rationale lives in
`SPEC-dsh-model-safety-gate.md` (working notes; not part of the npm tarball).

## 1. Product contract

Numbered, testable guarantees for version 0.1.0:

1. **Input block.** A user prompt matched by the safety policy can be blocked
   before the main-model request starts (via the DSH-native `agent/pre-step`
   reject); the blocked prompt is never forwarded to the model.
2. **Separate classifier model.** The safety classifier can run on a different
   provider/model than the main model — a DSH provider/model pair, an
   OpenAI-compatible endpoint, or be disabled (`backend: none`).
3. **No tools for the classifier.** Classifier calls carry no tool definitions
   and cannot invoke tools; they receive text and return a structured verdict.
4. **No recursive moderation.** A classifier call made through the host LLM
   service never triggers the plugin's own stream guard; exactly one classifier
   request produces exactly one provider request.
5. **Reasoning is checked online** when the provider streams
   `reasoning-delta` events; absence of reasoning is reported as
   `unavailable`, never as an error.
6. **Visible output is checked online** (`text-delta`) with rolling windows,
   not per token.
7. **Buffered mode quarantines.** In `buffered` streaming mode no byte of a
   quarantined window reaches the downstream consumer before its classifier
   verdict is `allow`/`warn`; blocked windows (and their pending buffer) are
   never yielded.
8. **Block aborts the provider request.** An output block cancels the active
   agent turn so the upstream AbortSignal reaches the provider adapter; the
   model stops generating.
9. **Tool-call gate.** Fully assembled tool calls pass through
   `tools/pre-execute` where the plugin can allow, defer to the DSH approval
   flow (ask), or deny before execution.
10. **Tool-result risk state.** Suspicious tool results (indirect prompt
    injection from untrusted sources) can mark the turn's risk state, which
    tightens subsequent tool-call decisions in the same turn.
11. **Monotonic safety merge.** A deterministic L0 block can never be weakened
    by the L1 classifier verdict; the merged decision only escalates
    (`allow < warn < block`).
12. **Audit is sanitized by default.** Audit records contain hashes, decision
    metadata, and truncated previews — never full blocked content, matched
    secret values, or raw spans unless `audit.includeRawContent` is enabled.
13. **Failure modes.** Classifier timeout/malformed/unavailable behaviour is
    configurable: `closed` (block), `open` (allow), `rules-only` (continue
    with L0), `ask` (defer to approval); default `rules-only`.
14. **Concurrency safety.** Concurrent sessions keep independent quarantine
    buffers, risk state, and classifier sequencing.
15. **No core patch.** The plugin registers only through official Cordis
    extension points (`agent/pre-step`, `llm/stream`, `tools/pre-execute`,
    `tools/post-execute`) and installs with a plain `dsh plugin add`.
16. **Peer-only runtime.** All `@deepseek-ai/*` packages are peer dependencies.

## 2. Data model

- **SafetyVerdict** (`version: 1`): `decision` = `allow | warn | review |
  block`, `confidence` in `0..1`, `categories: string[]`, `summary`, optional
  `policyRuleIds`. Classifier output is validated against the schema;
  malformed output is a classifier failure and follows the configured failure
  mode.
- **Audit record**: turn/step coordinates, direction (`input|output`), channel
  (`text|reasoning|tool|tool-result`), decision, categories, confidence,
  classifier provider/model, latency, `contentSha256`, policy version. No raw
  content by default.
- No on-disk persistence in 0.1: audit is a bounded in-memory ring per host
  process plus session events; counters are process-lifetime metrics.

## 3. Lifecycle

```
user message ─► agent/pre-step ─► L0 scan ─► L1 classify ─► policy merge
     │                                                        │
     │                              allow/warn ◄───────────────┤ block: pre-step reject
     ▼                                                        ▼
main model request ─► llm/stream wrapper (per-channel quarantine)
     │                                   │
     │            window full/adaptive ─► L0 → L1 snapshot
     │                                   │
     │            allow/warn: release approved prefix
     │            block: cancel turn (agent.cancel) → provider abort
     ▼
tool calls ─► tools/pre-execute ─► allow / ask (approval) / deny
tool results ─► tools/post-execute ─► L0 scan ─► optional L1 ─► turn risk state
```

Classifier calls run inside a process-local bypass marker
(`AsyncLocalStorage`), so the host `llm/stream` wrapper never re-applies the
guard to the classifier's own traffic.

## 4. Scope

### Included (0.1)

- Input guard on `agent/pre-step` with allow/warn/block.
- Output stream guard on `llm/stream` with `observe`, `interrupt`, and
  `buffered` modes; separate text and reasoning channels; rolling windows with
  lookbehind; bounded quarantine; overflow fails closed in buffered mode.
- Deterministic L0 scanner: injection patterns, jailbreak markers, secret and
  credential formats, Unicode obfuscation/zero-width characters, suspicious
  encoding, repeated-payload floods, user-configured patterns.
- Classifier service with `dsh`, `openai-compatible`, and `none` backends,
  strict verdict schema, timeout, temperature 0, bounded tokens.
- Tool gate on `tools/pre-execute` (allow/ask/deny) and tool-result scanning on
  `tools/post-execute` with per-turn risk state.
- Safety/quality separation: quality verdicts warn by default and never block
  unless explicitly opted in.
- Sanitized audit events (`safety/check|block|warn|classifier-error`), failure
  modes, monotonic merge, counters.

### Deferred

- Per-session mode override (audit/warn/enforce/disabled shield) — needs the
  client bundle; `allowSessionOverride` is already part of the config surface.
- Web settings page, chat moderation banners, session shield control (needs
  the client bundle; planned for 0.2).
- OpenTelemetry spans beyond counters (behind a telemetry-service probe).
- Controlled retry after a safety block (`maxSafetyRetries`).
- Persistent audit storage.
- `nonAgentRequests` enforcement modes beyond `bypass` (title generation,
  compaction stay unguarded; enforcement requires a known live Agent).

## 5. Required end-to-end scenarios

1. **Blocked prompt.** User sends a jailbreak prompt → pre-step rejects →
   model is never called → session records `safety/block` with the category.
2. **Quarantine.** Mock model streams an unsafe sentence split across chunks
   in buffered mode → classifier blocks → downstream observes no unsafe bytes;
   the turn ends aborted; the provider abort signal is observed.
3. **Classifier recursion.** A generation is scanned → the classifier call
   itself produces no additional scan passes (single-flight, one request).
4. **Classifier down.** Classifier endpoint times out → `rules-only` failure
   mode keeps the turn alive with L0 verdicts; `closed` mode blocks.
5. **Indirect injection.** A web_fetch result contains an injected instruction
   → result is flagged, turn risk becomes high → next sensitive tool call is
   denied or escalated to ask.
6. **Benign traffic.** Security-research-style discussion and quoted malicious
   content pass through without blocks (regression corpus with benign
   fixtures).

## 6. Implementation status

| Area | Status |
| --- | --- |
| L0 deterministic scanner | Implemented |
| Classifier service (dsh / openai-compatible / none) | Implemented |
| Input guard (`agent/pre-step`) | Implemented |
| Output stream guard with quarantine (`llm/stream`) | Implemented |
| Tool gate + tool-result risk state | Implemented |
| Audit events + counters | Implemented |
| Web UI (settings, banners, shield) | Planned (0.2) |
| Per-session mode override | Planned (0.2, needs UI) |
| OpenTelemetry spans | Planned |
| Adversarial corpus evaluation harness | Partial (fixtures + unit metrics) |
