# @yadsh/dsh-decision-tools

Agent tools for typed decisions through configured System One-compatible servers,
including local Jeff. No dependency on Jev Compaction or its session hooks.

## Tools

| Tool                        | Use                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `dsh_decision_capabilities` | List configured backend ids, declared kinds, credential readiness and limits; no inference |
| `dsh_decision_ask`          | Send a batch of arbitrary `noul`, `choice` and `score` questions                           |
| `dsh_decision_classify`     | Exclusive classification, or one yes/no question per label with `multilabel: true`         |
| `dsh_decision_check`        | Evaluate a named checklist with yes/no/uncertain results                                   |
| `dsh_decision_score`        | Rate text or JSON context against ordered levels                                           |
| `dsh_decision_rank`         | Score and rank candidate texts for a goal, retaining all candidates and stable tie order   |

`noul` returns the source score and `yes`, `no` or `uncertain`. Default yes/no
thresholds are 0.7/0.3. `choice` returns the winning label, the complete
distribution, backend confidence and an uncertainty flag. `score` preserves
the provider's ordinal expectation on `0..levels.length-1`, confidence,
probabilities and the rubric. It is not converted into a made-up percentage.
Choice/score confidence below 0.5 is marked uncertain by default.

These scores are model outputs, not guarantees of factual correctness. In
Jeff, confidence describes distribution peakedness; displayed probabilities
can be temperature-scaled while the ordinal score uses an untempered
distribution. Do not recompute `score` from displayed probabilities. Questions
can affect each other when Jeff runs with `JEFF_ISOLATE=none`; multiple-label
questions are not guaranteed statistically independent. Ranking may likewise
depend on the other candidates in the request. Validate task-specific quality
before treating these scores as action gates.

## Configuration

The host entry namespace is `dsh-decision-tools`. A host-only plugin has no
custom browser bundle or settings card; its Schemastery Config is the native
configuration surface. Example for a self-hosted backend:

```yaml
- id: dsh-decision-tools
  config:
    defaultBackend: local
    backends:
      - id: local
        baseUrl: http://scorer.example:8000
        model: jev-latest
        apiKeyEnv: DECISION_API_KEY
        kinds: [noul, choice, score]
    maxStateTokens: 2400
    maxRequestTokens: 2600
    maxStateChars: 9000
    timeoutMs: 45000
    maxConcurrency: 1
    maxQueue: 8
```

Only the operator configures URLs, models, credential-variable names and
supported kinds. A tool may select an existing `backend` id, never supply a
URL or credential. The default backend points at `http://localhost:8000` and
reads `JEFF_API_KEY`; in a container configure the actual service address.
An empty `apiKeyEnv` intentionally disables the Authorization header.
No other provider is selected automatically after a failure.

All config values are validated: 1–8 active calls, 0–64 queued calls,
100–120000 ms deadline, 1–128 questions, 2–64 labels, and 1 KiB–1 MiB response
cap. Defaults are one active call, eight waiting calls, eight questions,
sixteen labels, 45 seconds, and 256 KiB response bytes. Token estimates are
heuristics, not the backend tokenizer or billable usage. The state is never
silently truncated: oversize state/questions are refused with `STATE_LIMIT`
or `REQUEST_LIMIT`, so the agent must choose an explicit excerpt or split
the call. The concurrency gate covers this plugin's tools; other plugins
using the same inference server have their own concurrency controls.

## Examples

Choose an approach for a stated constraint:

```json
{
  "state": "Need to inspect an imported report while preserving original files.",
  "instructions": "Which approach best matches the requirement?",
  "labels": [
    { "id": "copy", "description": "Copy the input and inspect the copy" },
    { "id": "overwrite", "description": "Edit the original file directly" }
  ]
}
```

Pass that to `dsh_decision_classify`. For `dsh_decision_score`, provide
`state`, `instructions` and `levels`, e.g. `["irrelevant", "partly relevant",
"directly relevant"]`. Levels can also be `{ "what": "high", "examples":
["blocks the task"] }` objects, preserving the native score contract.

For `dsh_decision_rank`:

```json
{
  "goal": "Inspect report data while preserving original files",
  "levels": ["poor fit", "partial fit", "good fit"],
  "candidates": [
    { "id": "copy", "text": "Copy the report, then inspect the copy" },
    { "id": "edit", "text": "Rewrite the original report" }
  ]
}
```

The result includes a descending `ranking` and the underlying typed answers.
Equal scores keep input order. No chosen candidate is executed by this plugin.

For `dsh_decision_ask`, pass `state` and a `questions` array:

```json
{
  "state": { "message": "Report export crashes and blocks the task" },
  "questions": [
    {
      "id": "defect",
      "type": "noul",
      "instructions": "Does this describe a defect?"
    },
    {
      "id": "urgency",
      "type": "score",
      "instructions": "Rate urgency",
      "criteria": ["low", "medium", "high"]
    }
  ]
}
```

For `dsh_decision_check`, pass `state` and `criteria` entries with `id`,
`instructions` and optional `yes`/`no` criterion descriptions. All question,
label and candidate ids must be unique simple identifiers starting with a letter.

## Security model

Calls send only explicit supplied context to an operator-configured endpoint;
they do not read the conversation, files or network sources automatically.
Bearer keys are read from environment variables per call and never returned.
Redirects are rejected. No request/response body is logged. Errors contain a
stable category and actionable summary without raw backend bodies.
Canceling a tool or disposing the plugin cancels active and waiting calls;
the wall deadline includes queue wait and response streaming. Response bytes
are capped before JSON parsing, duplicate JSON keys and malformed typed
answers are rejected, and returned labels must exactly match the request.
Configuration-declared capabilities do not certify a backend or its quality.

## Deployment and validation

Install using `dsh plugin --profile <profile> add @yadsh/dsh-decision-tools`.
On a preset-based deployment, grant the six exact tool names above to the
intended agent role. Installing the bundle only registers global tools; it
does not bypass role filters or prove discovery in an existing chat. Start a
new chat and verify its actual tool catalog after applying the preset.

Run `pnpm --filter @yadsh/dsh-decision-tools run check` and
`pnpm tarball:verify:packages plugins/dsh-decision-tools`. Unit checks include
all question kinds, malformed responses, full-request/state limits, queue
cancellation, deadlines, disposal, multilabel classification and stable ranking.
Live tests must separately verify the local provider, all three question kinds,
and the agent-visible tools on the target host. A compatible wire format is
not a quality or calibration guarantee.

## Requirements and license

DeepSeek Harness >=0.1.7-rc.2 <0.2.0; Node.js ^22.19.0 or >=24.0.0. MIT.
