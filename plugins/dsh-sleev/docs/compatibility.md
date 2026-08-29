# Compatibility matrix

Last verified: 2026-08-27.

| Component           | Version / route                         | Result                                      |
| ------------------- | --------------------------------------- | ------------------------------------------- |
| DeepSeek Harness    | `0.1.1-rc.2`                            | supported                                   |
| Cordis              | `4.0.1`                                 | supported                                   |
| Sleev CLI + gateway | `1.7.7`                                 | healthy                                     |
| DSH adapter         | `@deepseek-ai/dsh-llm-pi-ai@0.1.1-rc.2` | supported                                   |
| Web settings        | DSH plugin configuration surface        | client bundle and `sleev` namespace served  |
| Sleev harness id    | `pi`                                    | works; still not a documented native DSH id |
| Upstream            | NeuralDeep / `gpt-oss-20b`              | compatibility smoke passed                  |

## Verified wire behavior

The reproducible `pnpm smoke:neuraldeep` test passed through the complete path:

```text
DSH LlmRuntime
  -> llm-pi-ai (openai-completions)
  -> Sleev 127.0.0.1:17321
  -> https://api.neuraldeep.ru/v1
  -> streamed DSH chunks
```

Verified on the route `sleev-neuraldeep`:

- ordinary text streaming completed;
- provider usage survived the gateway;
- a streamed tool call retained its name and JSON arguments;
- a follow-up containing the assistant tool call and user tool result completed;
- the observer recorded each gateway attempt independently;
- a direct NeuralDeep route coexisted with the Sleev alias.

The final successful A/B run reported 65 effective provider-input tokens for
the direct short prompt and 1,400 for the same prompt through Sleev. The Sleev
tool call used 1,431 and its tool-result continuation used 1,546. This is
expected to be an unfavorable comparison for a tiny prompt: it exposes the
gateway's fixed optimization instructions before there is stale history to
reclaim. It is transport evidence, not a savings benchmark.

An earlier tool-result attempt failed transiently at NeuralDeep and the next
attempt completed; the observer retained both attempts. The final A/B run then
completed without a retry and recorded exactly the three Sleev calls, excluding
the direct control request.

These short prompts establish transport compatibility, not context reduction.
A long tool-heavy session is still required to measure Sleev compression.
