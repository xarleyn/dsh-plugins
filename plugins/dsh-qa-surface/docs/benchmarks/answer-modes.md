# Comparing answer modes on the same corpus

## Results

Three identical questions went through each of six settings. The
four scored criteria are the known retention period, the two facts
from the partial case, and the expected acknowledgment of the absence
of published export terms. Citation accuracy is tracked independently.
Latency is the median over the three observed turns. Calls, tokens and
scenario prices are totals over the three questions.

| Setting | Criteria met | Median seconds | Model calls (reviewer) | Input tokens | Output tokens | Scenario USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Fast | 4 / 4 | 26.933 | 12 (0) | 35,622 | 463 | 0.037474 |
| Deep Thinking + Fast | 4 / 4 | 24.146 | 11 (0) | 31,733 | 393 | 0.033305 |
| Deep Thinking | 4 / 4 | 108.377 | 31 (6) | 122,845 | 2,484 | 0.132781 |
| Default with reviewer | 3 / 4 | 107.016 | 47 (6) | 202,562 | 3,380 | 0.216082 |
| RAG Priority, decline | 2 / 4 | 107.326 | 30 (6) | 117,365 | 2,989 | 0.129321 |
| RAG Priority, allow | 2 / 4 | 166.233 | 54 (6) | ≥241,781 | ≥3,559 | 0.256017–0.282129 |

There were 17 completed answers and one timeout. The timeout occurred
after 300.022 seconds on the absent question with RAG approval. Its
correctly cited draft is visible in the measurements and receives no
completed-answer point. The provider reported tokens for 27 of 28
calls in that turn. The price bound adds at most one 24,576-token prompt
and one 384-token completion at the scenario rates.

The reviewer issued 22 unsupported revisions and one pass. The pass
accepted a reply that denied a known fact. A request for a precise
quotation on the absent question was useful even though its verdict
incorrectly claimed that the primary agent had not read the catalogue.
A review cancelled during the timeout produced no verdict.

The Fast settings omitted the requested citation on the partial
question. Declining RAG expansion led to three answers that named
the local catalogue without reading it, even though no local read
was granted or executed. None of the absent-case answers invented
a numerical price or a currency. The complete per-question data,
including actual consent, successful file reads, final text and
individual quality judgments, is in the CSV.
[Per-question measurements](answer-mode-results.csv)

## Corpus and scoring

Each trial starts a new session under the same ordinary QA role. Resumed
segments use a fresh synthetic account in the same disposable profile. The
catalogue states that temporary reports are kept for **17 days**,
that their approval code is **`orchid-6`**, and that the price and currency
of external export are absent from the catalogue. The prompts and corpus
are frozen in [the driver](../../scripts/benchmark-answer-modes.cs).

| Question | Search index | Complete local catalogue | Ground truth |
| --- | --- | --- | --- |
| Retention | Retention statement with a source | Same fact | 17 days with a verified source |
| Retention and approval code | Retention only, with a source | Both facts | 17 days and `orchid-6` with verified sources |
| External export price and currency | No matches | No published price or currency | Explicitly identify the missing information, without inventing terms |

Judge the delivered answer against the complete catalogue and record the
scope allowed by the user. An accurate partial answer after declining
deep search respects policy and recovers one of the two facts. A correct
answer on the absent case must acknowledge the gap. A verified reference
is a source the agent actually received and whose contents substantiate
the claim. The reviewer's requests to revise are evaluated on the candidate
the reviewer received. A failure to produce a valid verdict is distinct
from an unsupported request to revise.

## What changed the answers

- On the known question, the index returned the 17-day retention period.
  In three reviewed settings the first candidate stated the fact
  correctly and the delivered response claimed it was missing. The
  reviewer repeatedly treated the virtual index reference as a local file
  and sometimes claimed to have checked documents without a successful
  read. The default reviewed path passed a revised response that denied
  the known fact.
- On the partial question, declining expansion kept the local source
  unread. The answer retained 17 days and signaled the missing code,
  but named the unread catalogue in its description of where the code
  was missing. After approval the agent read the catalogue and returned
  both 17 days and `orchid-6`. The comparison took 107.003 s with
  decline and 166.233 s with approval.
- On the absent question, Fast and Deep Thinking + Fast cited the
  catalogue's scoped statement that no price or currency was published.
  The reviewer in Deep Thinking asked for more precise evidence, and the
  primary added the exact passage and line number. The next verdict
  still rejected that cited passage as unverified. RAG with approval
  reached a correctly cited draft but exceeded the five-minute budget.
- The gate's conversation context extracts human messages and answers to
  question forms. It does not include ordinary file or RAG tool results.
  Supplying bounded, attributable excerpts to the reviewer would let it
  compare each claim to the same evidence and preserve the recorded
  consent scope. The benchmark leaves that change for a separate review.
  [Current context builder](../../../dsh-answer-review-gate/src/context.ts)

For a low-risk answer with an easily checked source, the settings using
Fast gave the lowest observed latency in this fixture. Check citations
independently when a Fast response provides the right values but omits a source.
Keep consent for expansion. Advance the reviewer only after repeating
these cases with the same evidence available to both roles and checking
that it preserves verified facts and distinguishes genuine gaps.

## Method

The run used Harness `0.2.2-rc.3`, QA Surface `0.23.5`, answer review
gate `0.3.10` and LightRAG `0.3.1`. The model was Qwen3.5-4B
Q4_K_M served on an AMD Ryzen 5 9600X by llama.cpp build
`11963-39febd2ad`. It ran with six CPU threads, one inference slot, a
24,576-token context and a 384-token output cap per call. Treat
single-trial wall times as observations on a shared workstation.
The SHA256 digest of the GGUF file was
`00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4`.
The local server exited at cancellation and was restarted with the same
weights and options. Subsequent attempts that never reached the model
were discarded and rerun. The final sample contains one row per
question and setting. Two early non-RAG control rows each used one index
lookup and were unaffected by the later RAG visibility and retry bounds.
Another QA change was built and verified while the main matrix ran.

- The same installed Harness, QA Surface, review gate and LightRAG tool
  run in a disposable local profile. The catalogue is a real file in the
  test account's workspace. A local deterministic endpoint supplies
  LightRAG's result for the current question. This controls coverage across
  strategies and removes indexing, ranking and corpus changes from the
  experiment.
- The six settings are Fast, explicit Deep Thinking, RAG Priority with
  decline on a consent prompt, the default reviewed request, RAG Priority
  with consent, and Deep Thinking with Fast. The two RAG settings both
  enable Deep Thinking. Deep research remains locked until consent.
  When the index sufficiently covers a question, the proper RAG path
  answers without showing a prompt. Default QA requests already
  resolve to Deep Thinking. An explicit `deep` request checks the same
  policy, and the two explicit Deep settings isolate the review switch.
- Model requests use the same local weights for both roles. The relay
  preserves the Harness messages and advertises only the catalogue and
  role tools needed by the fixture. The Host still executes tools and
  enforces consent. In the RAG trials the displayed tools follow the
  consent state. The relay allows one index lookup and one reformulation
  before hiding the query tool because the fixture returns identical
  coverage on further calls. Other interactive questions receive a
  skip. The relay disables prompt caching and
  model thinking, sets temperature to zero, fixes the seed and records
  the provider's usage fields. Reviewer aliases identify calls without
  changing weights. Wall time starts at request submission and ends at
  chat completion, including QA polling and the scripted consent action.
  The measured time excludes a person's decision time. Test cases run
  in series, with the order of settings rotated across the three questions.
- The review gate uses its subagent backend with two rounds, a 90-second
  deadline per round and warn-on-failure behavior. The test reviewer sees
  the normal review packet and has read permission. Its benchmark
  instructions distinguish a virtual index reference from the local
  catalogue, allow one direct file read, and ask for the normal
  structured verdict. This controls source discovery for the reviewer
  while leaving the judgment to the model.
- Scenario price uses **USD 1 per million input tokens** and **USD 4 per
  million output tokens** for both roles. Local inference generated no
  provider invoice. Electricity and hardware costs were outside the
  measurement. A real retrieval service may add its own latency, tokens
  and charges.

## Reproduce

Use an installed .NET 10 or newer SDK and a loopback OpenAI-compatible
model server that reports usage on streaming responses. Build the
workspace packages before packing them. The following example assumes
an already running synthetic benchmark model server and a new output file.

```powershell
$env:NX_DAEMON = 'false'
pnpm nx run-many -t build --projects='@yadsh/dsh-qa-surface,@yadsh/dsh-answer-review-gate,@yadsh/dsh-lightrag,@yadsh/dsh-domain-experts' --skip-nx-cache
$env:DSH_QA_BENCH_ENDPOINT = 'http://127.0.0.1:8000'
$env:DSH_QA_BENCH_MODEL = 'qa-benchmark'
$env:DSH_QA_BENCH_RESULTS = Join-Path $env:TEMP 'answer-mode-run.jsonl'
pnpm --filter '@yadsh/dsh-qa-surface' smoke:packed --compare-answer-modes
```

The JSONL contains the full synthetic answers and their tool evidence,
provider usage, timings, consent decisions and review receipts. The tool
will not overwrite an existing run file. Keep the raw file private
because tool evidence includes local workspace paths. A local model is required for
this comparison. The deterministic runner for the same Harness modes,
`smoke:packed --answer-modes`, can run separately.

Use `DSH_QA_BENCH_SKIP` and `DSH_QA_BENCH_LIMIT` to repeat a fixed
slice in a newly provisioned profile. Write it to a separate JSONL file.
A trial that exceeds five minutes is cancelled through the Host and
recorded as a timeout. A call whose stream ended without usage counts
toward the call total. Its tokens are unknown, and the observed sum for
the trial is a lower bound.
