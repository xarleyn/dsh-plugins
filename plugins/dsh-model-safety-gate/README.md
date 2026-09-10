# @yadsh/dsh-model-safety-gate

Independent defense-in-depth safety gate for DeepSeek Harness: a deterministic
scanner plus an isolated small-model classifier check user prompts, streamed
model output (text and reasoning), tool calls, and tool results before they
reach the model, the user, or the execution layer.

The gate is an additional decision layer. It does not replace the DSH sandbox,
the permission system, or approval gates, and it never patches DSH core.

## Features

- **Input guard** (`agent/pre-step`): prompts are normalized and scanned
  before the main-model request; matched prompts can be warned about or
  blocked outright, with a sanitized reason published to the session.
- **Output stream guard** (`llm/stream`): `text-delta` and `reasoning-delta`
  channels are checked with rolling windows. In the default `buffered` mode
  chunks are quarantined until their window passes, so blocked content never
  reaches the UI or session; blocking aborts the upstream provider request.
- **Tool gate** (`tools/pre-execute`): fully assembled tool calls are checked
  before execution — allow, defer to the native DSH approval flow, or deny.
- **Indirect-injection guard** (`tools/post-execute`): tool results from
  untrusted sources are scanned; hits raise the turn risk state, which
  tightens decisions for subsequent sensitive tool calls.
- **Two classification layers**: L0 is a fast local scanner (injection
  patterns, jailbreak markers, secrets/credential formats, Unicode
  obfuscation, zero-width characters, suspicious encoding, repeated-payload
  floods, user patterns). L1 is an isolated safety classifier on a small
  model — a DSH provider/model pair, an OpenAI-compatible endpoint, or off.
- **Monotonic safety merge**: deterministic red lines cannot be weakened by
  the classifier; verdicts only escalate.
- **Failure modes**: classifier timeout or malformed output follows the
  configured failure mode — `closed`, `open`, `rules-only` (default), `ask`.
- **Safety ≠ usefulness**: quality verdicts (unclear, spam, low-information)
  warn by default and never block unless explicitly opted in.
- **Sanitized audit**: session events and counters record decisions with
  content hashes, never raw blocked content or secret values (raw logging is
  opt-in).
- **Classifier isolation**: classifier calls run under a process-local bypass
  marker, so moderating a generation never recursively moderates the
  moderator; the classifier has no tools.

## Install

```bash
dsh plugin add @yadsh/dsh-model-safety-gate
```

## Configuration

All options are optional; defaults are shown.

```yaml
enabled: true            # master switch for the whole gate
mode: warn               # off | audit | warn | enforce — default decision profile

classifier:
  backend: none          # none | dsh | openai-compatible
  provider: ""           # backend: dsh — DSH provider id for the classifier model
  model: ""              # backend: dsh — model id
  baseURL: ""            # backend: openai-compatible — endpoint base URL
  apiKey: ""             # backend: openai-compatible — API key (kept out of logs)
  timeoutMs: 3000        # classifier request timeout
  maxTokens: 128         # bounded structured response
  temperature: 0
  failureMode: rules-only # closed | open | rules-only | ask — on timeout/error/malformed
  requireLocal: false     # true forbids remote (openai-compatible) endpoints

input:
  enabled: true          # gate user prompts on agent/pre-step
  safetyAction: block    # allow | warn | block for safety verdicts
  qualityAction: warn    # allow | warn | block for quality-only verdicts (block = opt-in)

output:
  enabled: true          # gate main-model streaming output
  mode: buffered         # observe | interrupt | buffered
  text: true             # check the visible-answer channel
  reasoning: true        # check the reasoning channel when the provider streams it
  checkEveryChars: 512   # new quarantined chars between classifier snapshots
  windowChars: 1536      # snapshot window size sent to the classifier
  lookbehindChars: 768   # preceding context included with each window
  minCheckIntervalMs: 250
  maxBufferedChars: 8192 # overflow fails closed in buffered mode

tools:
  enabled: true          # gate tool calls on tools/pre-execute
  semanticClassifier: true

toolResults:
  enabled: true          # scan tool results on tools/post-execute
  classifyUntrustedSources: true

audit:
  enabled: true
  includeRawContent: false # opt-in raw content logging (default: hashes only)

ui:
  enabled: true
  showWarnings: true

allowSessionOverride: true # false forbids per-session downgrade of the global mode
```

### Deployment presets

| Profile | Input | Output | Tools | Failure mode |
| --- | --- | --- | --- | --- |
| Personal | warn | interrupt | ask | rules-only |
| Balanced | block | buffered | ask | rules-only |
| Strict | block | buffered (text + reasoning) | block | closed, session override disabled |

### Privacy

If the classifier backend is `openai-compatible`, prompts, streamed output,
and reasoning content are sent to that endpoint. The configuration surface
reports this; set `classifier.requireLocal: true` to forbid remote endpoints
entirely.

## Compatibility

- DeepSeek Harness `>=0.1.5-rc.2 <0.2.0` (channel `next`), extension points:
  `agent/pre-step`, `llm/stream`, `tools/pre-execute`, `tools/post-execute`.
- Node.js `^22.19.0 || >=24.0.0`.
- See [compatibility.json](./compatibility.json) for the machine-readable
  manifest.

## Development

```bash
pnpm nx run dsh-model-safety-gate:lint
pnpm nx run dsh-model-safety-gate:typecheck
pnpm nx run dsh-model-safety-gate:test
pnpm nx run dsh-model-safety-gate:build
pnpm nx run dsh-model-safety-gate:verify
```

## License

MIT — see [LICENSE](./LICENSE). Architecture credits are listed in
[NOTICE.md](./NOTICE.md).
