# @yadsh/dsh-llm-provider-extended

Full DSH provider adapter with generation controls and typed System One decisions

## Features

This is a complete port of the stock `@deepseek-ai/dsh-llm-pi-ai` provider implementation, extended with generation controls and a Plugins-panel configuration body. It retains the installed provider/model catalog, custom routes, model discovery, credentials and native login flows, reasoning efforts and compatibility dialects, tools, image attachments and budgets, native history replay, attribution headers, cancellation, idle watchdogs, transport selection and provider retry policy. Catalog providers retain their own native protocols; manually declared routes support OpenAI Chat Completions, OpenAI Responses and Anthropic Messages.

Provider and model profiles add `generation`: `temperature`, `topP`, `topK`, `minP`, `frequencyPenalty`, `presencePenalty`, `seed`, and `stop`. Model defaults override provider defaults; explicit request temperature/stop override both. Omitted fields keep provider behavior, and zero is preserved. Prepared calls retain one immutable settings generation.

| Protocol | Additional generation settings |
| --- | --- |
| OpenAI Chat Completions | Temperature, Top P, Top K, Min P, frequency/presence penalties, Seed, Stop |
| OpenAI Responses | Temperature, Top P |
| Anthropic Messages | Temperature (0–1), Top P, Top K, Stop; configure either Temperature or Top P |
| Other catalog protocols | Temperature through the native SDK when supported |
| System One | Typed `state`/`questions` only; generation settings are refused |

Top K, Min P and Seed are gateway extensions: the configured server must support them. A model or reasoning mode that suppresses temperature is refused when a temperature is explicitly configured. Unsupported protocol settings fail with a diagnostic instead of disappearing from the request.

## Requirements

- DeepSeek Harness >=0.1.7-rc.2 <0.2.0
- Node.js ^22.19.0 or >=24.0.0

## Installation

```bash
dsh plugin --profile web add @yadsh/dsh-llm-provider-extended
```

`--profile` is required: `dsh plugin add <package>` rejects a call without one.
The package must be published before the registry command can work. Until then, install from a built checkout:

```bash
pnpm --filter @yadsh/dsh-llm-provider-extended build
dsh plugin --profile web add ./plugins/dsh-llm-provider-extended
```

To remove the plugin:

```bash
dsh plugin --profile web remove @yadsh/dsh-llm-provider-extended
```

## Configuration

The bundled row and settings namespace are `dsh-llm-provider-extended`. Open **Plugins → Extended LLM providers** for provider CRUD, base URL/protocol, credential reference, model capacities/modalities and generation defaults. The body uses the Host's card frame and focus tokens. Saving fences the revision read when the editor opened; a concurrent write requires reopening the editor. A composition-owned provider can restore its composition settings; a user-added provider can be deleted. Settings remain visible when read-only; a Host without a managed profile reports them unavailable.

The advanced JSON editor preserves every stock provider field: model overrides, reasoning, compatibility, headers, cache retention, transports, deadlines, retry policy and image budgets. Apply JSON to the draft, then save it. Fetch available models, manage actual API keys and use native provider login in the Host **Models** settings. That page also exposes this plugin's chat routes through the stock configurable-provider directory. Use this plugin's card for System One configuration, since the stock protocol selector has only three chat protocols.

```yaml
- id: dsh-llm-provider-extended
  name: '@yadsh/dsh-llm-provider-extended'
  config:
    providers:
      local-gateway:
        displayName: Local gateway
        api: openai-completions
        baseURL: https://gateway.example.com/v1
        apiKeyEnv: DEMO_GATEWAY_KEY
        generation:
          temperature: 0.7
          topP: 0.9
        models:
          - id: demo-model
            contextWindow: 131072
            maxTokens: 8192
            input: [text, image]
            generation:
              temperature: 0.3
      decisions:
        displayName: System One decisions
        api: systemone
        baseURL: https://api.typesafe.ai/v1
        apiKeyEnv: TYPESAFE_API_KEY
        timeoutMs: 60000
        models:
          - id: jev-latest
            contextWindow: 32768
            input: [text]
```

No raw key is saved in this config. Named credentials resolve through the Host credential seam, with launch-environment fallback only when that seam is absent. Missing named credentials fail rather than choosing an unrelated ambient key.

## Migration from the stock adapter

Copy the existing stock instance's entire `config.providers` map to this row; existing fields retain their meaning. Stop configuring those routes in the stock `dsh-llm-pi-ai` instance before enabling them here: the LLM registry allows only one owner per route, and both adapters expose the installed configurable-provider directory. Replace the stock instance rather than mounting a second catalog directory beside it. Keep the same provider route ids, model ids and `apiKeyEnv` references. Native login record keys are preserved. Existing provider-native replay is retained when owned by this adapter; unusable state degrades with the upstream diagnostic.

User overrides stored under the previous settings namespace must be copied explicitly to the new namespace. The plugin does not move credential files, rewrite other adapter configurations, or restart a live Host automatically. The official DeepSeek adapter is a separate adapter and can remain installed when its provider routes/directory entries do not collide. Existing `dsh-llm-gateway-compat` behavior was not used as the implementation source; parity is with the pinned stock pi-ai adapter.

## System One

The fourth protocol calls `/systemone` relative to the configured base URL (normally ending in `/v1`); a URL already ending in `/systemone` is accepted. There is no implicit endpoint or hosted fallback. Requests are limited to 250,000 JSON characters and 64 questions, responses to 1 MiB, and deadlines to at most 300 seconds. Backend-specific limits may be lower.

System One is a decision API rather than an agent chat backend. A direct model-seam call must carry exactly one user text message containing this JSON envelope:

```json
{
  "state": "The synthetic support request reports a failed payment.",
  "questions": {
    "needs_followup": { "type": "noul", "instructions": "Does this need follow-up?" },
    "team": {
      "type": "choice",
      "instructions": "Which team should handle this?",
      "criteria": { "support": "Technical issues", "billing": "Payment issues" }
    },
    "priority": {
      "type": "score",
      "instructions": "Rate urgency.",
      "criteria": ["Low", "Medium", "High"]
    }
  }
}
```

The adapter sends `model`, `state` and `questions`, validates answer identity/type, probability distributions, confidence, fractional score ranges and usage, and returns the native JSON response as one text block. Usage precedes finish; this chunk vocabulary does not imply network streaming. It refuses normal chat history, system prompts, tools, reasoning, images, sampling, stop sequences and output caps before sending. Do not select it as a normal tool-using agent's main model. Higher-level decision tools can call the native protocol independently; this package does not register duplicate decision tools.

Host integrations use `ctx.llm.resolveModelInfo(provider, model, signal)` for metadata and `ctx.llm.stream({ provider, model, messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify({ state, questions }) }] }], signal })` for the call. DSH 0.1.7-rc.2 does not expose a `generate()` method. The response JSON includes the resolved backend `model`, `answers` and native `usage`; a separate usage chunk reports Harness `inputTokens`/`outputTokens`. Consume either the text deltas or the completed text block, rather than concatenating both. Native `maxTokens` is not advertised as a default. Retryable failures follow the Harness `RATE_LIMIT`/`SERVER`/`TRANSPORT`/`TIMEOUT` taxonomy and preserve HTTP status and Retry-After facts. Caller cancellation and deadline also cover credential resolution.

Contract: [TypeSafe API reference](https://docs.typesafe.ai/api). The [user-supplied community guide](https://typesafe-jev.com/en/guides/api/) provides a walkthrough. The official API is the wire source of truth.

## Specification

See [SPEC.md](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-llm-provider-extended/SPEC.md).

## Compatibility

- DeepSeek Harness >=0.1.7-rc.2 <0.2.0 (see `compatibility.json`)

## Development

```bash
pnpm --filter @yadsh/dsh-llm-provider-extended check
pnpm tarball:verify:packages plugins/dsh-llm-provider-extended
```

## License

MIT. The upstream implementation is pinned to `deepseek-ai/deepseek-harness@477b4f420553e8a52c2fbccc464d7561b239c443` with `@earendil-works/pi-ai@0.85.1`. See `NOTICE.md` and `UPSTREAM_LICENSE`. The published pi-ai dependency is unmodified; upstream development-only SDK performance patches are not shipped here. Tests cover the Harness stream contract, including raw tool-call arguments, rather than requiring a private SDK patch.
