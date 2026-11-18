# Should oversized tool results be split?

**Decision, 2026-11-18.** Keep the 300,000-byte passthrough. Exact citations
and quoted values are the acceptance criterion for this workload. A small
summary that says `NONE` passes the current size validator even when the
original contains evidence.

## Measurements

Each row below covers the same six oversized inputs (three workloads × two
seeds), totaling 1,870,996 bytes. Bytes, tokens, calls, evidence and cost are
totals. Time is the mean per input, counting serial worker calls and the parent
answer. The first evidence count is measured before the parent reads the
result. The second counts what the parent actually returned. Both are out of
36 expected citation/quote pairs. [Per-input measurements](oversized-results.csv)

| Path | Bytes to parent | Body tokens to parent | Worker calls | Worker tokens in / out | Seconds per input | Scenario USD | Evidence delivered / answered |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Current passthrough | 1,870,996 | 506,875 | 0 | 0 / 0 | 39.32 | 0.51006 | 36 / 26 |
| 64,000-byte maps | 1,243 | 404 | 30 | 514,785 / 410 | 28.66 | 0.10536 | 10 / 10 |
| Same maps + reduce | 831 | 278 | 36 | 516,619 / 694 | 29.21 | 0.10562 | 9 / 9 |
| 16,000-byte maps | 6,385 | 1,576 | 120 | 538,515 / 1,582 | 30.61 | 0.11235 | 15 / 11 |
| Same maps + reduce | 1,014 | 356 | 126 | 541,521 / 1,944 | 31.37 | 0.11195 | 12 / 12 |

| Evidence delivered / answered, out of 12 per workload | Current | 64,000 maps | + reduce | 16,000 maps | + reduce |
| --- | ---: | ---: | ---: | ---: | ---: |
| Source | 12 / 5 | 0 / 0 | 0 / 0 | 2 / 2 | 2 / 2 |
| Search | 12 / 12 | 9 / 9 | 8 / 8 | 10 / 6 | 7 / 7 |
| Log | 12 / 9 | 1 / 1 | 1 / 1 | 3 / 3 | 3 / 3 |

The smaller chunks are a sensitivity check prompted by the first source
result. They improved delivery from 10 to 15 pairs. Adding the reducer then
dropped three delivered pairs, although the parent recovered one additional
pair in its own answer. The project's existing 95% retention target requires
at least 35 of 36 delivered pairs. The direct parent also missed ten pairs
from complete input, so access to an original and accurate extraction are
separate measurements.

On six **in-budget controls**, the normal single worker transformed
191,047 bytes / 50,242 body tokens into 1,948 bytes / 683 tokens for the
parent. It delivered 22/36 pairs and the parent returned those same 22.
Mean time was 5.31 seconds including the parent, for $0.01460 across six
inputs under the stated rates. These smaller controls have different texts.

The price advantage depends on a cheaper worker. Pricing both roles equally
at $1 input / $4 output per million gives $0.51006 for passthrough, $0.51850
for large-chunk maps and $0.52114 with their reducer. Smaller-chunk maps cost
$0.54823 at equal rates, rising to $0.55138 with reduction.

## How the comparison works

Two seeds (17 and 41) generate a source listing, repository search matches and
an operational log at each size. A fixture has six confirmed records scattered
from the first to the last percentile among drafts or routine records. Each
record pairs a synthetic path and line number with an exact quote. The prompt
describes what to collect. Expected citations and quotes stay with the scorer.
A point requires both on the same output line. The scorer runs once on the text
delivered to the parent and again on the parent's actual answer. This measures
verbatim evidence retention on an extraction task.

- The in-budget controls are about 32,000 bytes. They use one configured
  worker. The oversized cases are about 312,000 bytes, where the current
  plugin forwards the original. Routing, worker prompts and the size validator
  come from the built plugin. The log fixture adds a `read_log` rule mapped to
  the bundled `logs` profile. Source and search use their standard profiles.
- The alternatives split the same UTF-8 input at complete line boundaries,
  assert byte-for-byte reconstruction and map every chunk in order. The parent
  receives either the joined extracts or a reducer's output over those exact
  extracts. Each reducer row includes the cost and time of its map calls.
  A fresh parent request receives the question and the visible result in one
  user message on every path.
- One local Qwen3.5-4B Q4_K_M served both roles on an RTX 3060 12 GB with
  llama.cpp `b11963-39febd2ad`, a 131,072-token context, one slot, reasoning
  off, temperature zero, prompt caching off and a 512-token output cap per
  call. The GGUF SHA-256 was
  `00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4`.
  The endpoint was warm. Work ran serially with no tools. Timings cover
  HTTP inference through the full reply. They exclude token-count diagnostics,
  benchmark driver startup and Harness agent scheduling.
- Bytes are UTF-8. Body tokens come from the serving tokenizer. Input and
  output tokens for each model call come from the provider's usage fields,
  including the prompt wrapper. All inference ran locally. The USD comparison
  prices one parent exposure at illustrative rates per million tokens of
  $1 input / $4 output for the parent and $0.20 / $0.80 for the worker. No
  provider invoice or electricity tariff was involved.

## Frequency in an observed workload

A read-only count of exported QA histories covered 775 unseeded root sessions.
Of 12,912 recorded tool results, 12 could not be joined to a tool call.
Among 2,249 matched successful text results from the four default allowlisted
tools, 184 were at least 24,000 bytes and **zero exceeded 300,000**. The median
was 2,128 bytes, p95 was 33,606, p99 was 54,948 and the maximum was 85,486.
These are persisted, model-facing bytes from a convenience sample. Prior
transformations can shrink them. Raw deployment traffic would require
pre-transform size measurements. Only aggregate counts were retained here.

## Conditions for reconsidering

Reopen the decision if pre-routing telemetry shows frequent oversized results
and paired runs on representative worker/parent routes meet the 95% evidence
target without sacrificing parent-answer accuracy. Compare maps alone first.
The reducer has to earn its extra call on identical map outputs.

Any production candidate must keep the original canonical value intact, keep
the full effective result available for fallback, and provide a retrievable
original if the compact form is retained for later turns. Chunk concatenation
reconstructed every fixture here. The benchmark adds no persistent object
store. The real hook's integration tests cover canonical values, downstream
content overrides, cancellation, timeouts and original-result fallback.

A production experiment would need a single deadline across the chain, total
input/output token and call limits, the existing per-parent/global worker
ceilings, and cancellation of all outstanding work. Return the complete
effective result on a failed, cancelled or rejected part. The benchmark used
one slot, a 15-minute experimental chain ceiling and at most 5 or 20 maps plus
one reducer. Its completion times are measurements, not a guarantee that a
concurrent deployment fits the existing 45-second worker timeout.

## Reproduce

Use a .NET file-app SDK (tested on 11.0.100), build the plugin and start a
local llama.cpp server exposing `/tokenize` and
`/v1/chat/completions`. Give the parent room for the largest input (about
102,000 tokens plus the response). These examples use a loopback server with
the model alias `offload-worker`.

```sh
pnpm --filter @yadsh/dsh-tool-offload build
dotnet run --file plugins/dsh-tool-offload/scripts/benchmark-offload.cs -- http://127.0.0.1:8080 offload-worker 17
dotnet run --file plugins/dsh-tool-offload/scripts/benchmark-offload.cs -- http://127.0.0.1:8080 offload-worker 17 all 16000 --chunks-only
```

Repeat with seed 41. The command emits JSON lines on stdout with the input
digest, actual calls, timings, missing evidence and answers. A failed request
or invalid output fails the run. The optional frequency command reads exported
v3/v4 JSONL files and prints only counts and byte lengths.

```sh
dotnet run --file plugins/dsh-tool-offload/scripts/benchmark-frequency.cs -- PATH_TO_EXPORT
```
