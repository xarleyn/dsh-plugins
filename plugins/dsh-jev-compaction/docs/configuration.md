# Configuration reference

Every field below can be set in the profile's `cordis.patch.yml` (or the
deployment's `cordis.yml`) and, unless marked **deployment-only**, edited at
runtime from the settings card (**Settings → Plugins → Jev Compaction**).

Settings layer in this order, each overriding the one before it:

```text
schema defaults → deployment/composition config → user settings (the card)
```

A field the user layer does not mention keeps its composition value; a field
the user layer _does_ mention is marked `overridden` in the card and can be
reset back to the deployment default there.

## `enabled`

Master switch. When `false` the plugin keeps its listeners but never acts:
no immediate shaping and no automatic historical pruning. `/jev-compact
--dry-run` still reports what it would do.

## `resultShaping` — immediate result shaping

Runs at `tools/post-execute`, **before** the final `tool/result` is persisted.
Off by default.

| Field                         | Default                                                                   | Meaning                                                  |
| ----------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------- |
| `enabled`                     | `false`                                                                   | Opt-in master switch for this layer                      |
| `includeTools`                | `bash`, `terminal`, `pwsh`, `run_command`, `execute_command`, `run_tests` | Tools whose results may be shaped                        |
| `excludeTools`                | `[]`                                                                      | Never shaped; wins over `includeTools`                   |
| `thresholdChars`              | `12000`                                                                   | Minimum text length before shaping is considered         |
| `hardLengthTriggerChars`      | `32000`                                                                   | Long enough to be considered even without line structure |
| `minLines`                    | `80`                                                                      | Line-count trigger                                       |
| `repetitionTriggerRatio`      | `0.45`                                                                    | Fraction of lines inside collapsible runs                |
| `maxPerTurn`                  | `2`                                                                       | Shaping requests allowed per turn                        |
| `maxConcurrent`               | `2`                                                                       | Concurrent shaping requests                              |
| `preserveErrors`              | `true`                                                                    | Leave failed tool results untouched                      |
| `minRunLines`                 | `3`                                                                       | Shortest run that may collapse                           |
| `keepHeadLines`               | `8`                                                                       | Head lines pinned from collapsing                        |
| `keepTailLines`               | `12`                                                                      | Tail lines pinned from collapsing                        |
| `minClassificationConfidence` | `0.60`                                                                    | Below this the run is kept                               |
| `minSavingsChars`             | `4000`                                                                    | Gate: minimum characters saved                           |
| `minSavingsRatio`             | `0.30`                                                                    | Gate: minimum fraction saved                             |
| `requestTimeoutMs`            | `2500`                                                                    | Per-request deadline on the tool path                    |
| `maxInputCharsPerTurn`        | `50000`                                                                   | Character budget for shaping requests per turn           |

A result is a candidate when it is enabled, the tool is allowed, the result is
successful, its text is long enough, and it is line-heavy, repetition-heavy or
very long. It is skipped when the text is already shaped, already bounded by
another layer (the spill notice or the tool-result pruner's marker), an error
with `preserveErrors` on, or non-text in a way that cannot be rebuilt
unambiguously.

Text blocks are shaped; non-text blocks keep their position. A result with
several text blocks _interleaved_ with non-text blocks is skipped entirely
rather than guessed at.

The classifier answers two questions per run — is this routine repetition, and
would removing it materially reduce the ability to make the correct next
decision — and a run collapses only when `routine >= minClassificationConfidence`
and `needed <= 1 - minClassificationConfidence`. Anything else, including a
missing or malformed answer, keeps the lines.

The savings gate is applied to the whole result: if the shaping saves less than
`minSavingsChars` _and_ less than `minSavingsRatio` of the original, the
original is kept and the work is discarded.

### Line shapes

Two adjacent lines are collapsed together only if they share a _shape_.
Normalization replaces volatile values — ANSI escapes, ISO and clock
timestamps, UUIDs, long hex digests, percentages, and standalone counters —
and deliberately preserves line/column positions, dotted versions, HTTP status
codes, exit codes and identifiers such as short commit hashes. Names and short
numbers are never normalized, so two different tests or two different
durations do not share a shape.

Only _contiguous_ same-shape runs are grouped: scattered identical lines are
never merged, which is what keeps reconstruction order-preserving.

### Pins

The head (`keepHeadLines`), the tail (`keepTailLines`), blank lines, and any
line that looks like a conclusion, a failure, a warning, a stack frame, a
compiler diagnostic, an exit status or a package-manager/build summary are
pinned before classification. A pinned line splits a run, so an error in the
middle of a progress bar collapses on both sides of it and never across it.
Pins are heuristic aids, not a guarantee — the classifier and the savings gate
are the other two signals.

## `archive` — original output archive

Immediate shaping happens before DSH persists the result, so the archive is the
only copy of the pre-shaping original.

| Field           | Default         | Meaning                                                                           |
| --------------- | --------------- | --------------------------------------------------------------------------------- |
| `enabled`       | `true`          | Archive before shaping                                                            |
| `rootPath`      | `""`            | **Deployment-only.** Empty resolves `$DSH_HOME/data/dsh-jev-compaction/originals` |
| `retentionDays` | `14`            | Older entries are removed; `0` keeps them                                         |
| `maxBytes`      | `1073741824`    | Size ceiling, oldest-first; `0` disables it                                       |
| `deduplicate`   | `true`          | Reuse the entry when the content hash already exists                              |
| `onFailure`     | `keep-original` | `keep-original` skips shaping; `shape-anyway` shapes without a reference          |

Entries are content-addressed (`sha256:<hex>`), stored one JSON file per
distinct payload, written atomically, and verified against their hash on read —
a tampered entry is reported as missing instead of returned as truth.
Retention runs lazily and never on the shaping path.

The shaped text receives a short opaque reference
(`sha256:0123456789ab`), never a path. It is not a capability: nothing resolves
it without a plugin-side lookup the model cannot perform.

Turning the archive off while shaping is on is shown in the card as a warning —
"Shaped output may not be recoverable from session replay" — not a tooltip.

## `historical` — the settings card's name for the compression layer

The historical layer keeps its existing field names; the card groups them under
_Historical compaction_:

| Card field                | Config field                                  | Default         |
| ------------------------- | --------------------------------------------- | --------------- |
| Start semantic pruning at | `trigger.contextRatio`                        | `0.70`          |
| Minimum surface tokens    | `trigger.minSurfaceTokens`                    | `32000`         |
| Preserve recent messages  | `preserve.recentMessages`                     | `6`             |
| Preserve recent tokens    | `preserve.recentTokens`                       | `12000`         |
| Full-keep threshold       | `decisions.fullThreshold`                     | `0.70`          |
| Truncate threshold        | `decisions.truncateThreshold`                 | `0.45`          |
| Minimum savings           | `pruning.minSavingsChars` / `minSavingsRatio` | `8000` / `0.05` |
| Preserve errors           | `preserve.errors`                             | `true`          |

`decisions.truncateThreshold` must not exceed `decisions.fullThreshold`; the
settings service refuses the write otherwise.

## `decision` / `jev` — the decision backend

| Card field                   | Config field         | Notes                                                                                 |
| ---------------------------- | -------------------- | ------------------------------------------------------------------------------------- |
| Provider                     | `decision.provider`  | `typesafe` (default), `jeff`, `custom`                                                |
| Endpoint                     | `jev.baseUrl`        | Required for `custom`                                                                 |
| Model                        | `jev.model`          |                                                                                       |
| API key environment variable | `jev.apiKeyEnv`      | **The variable name only.** The key is read on the host and never sent to the browser |
| Request timeout              | `jev.timeoutMs`      | Clamped `500`–`60000`                                                                 |
| Concurrent Jev requests      | `jev.maxConcurrency` | Clamped `1`–`8`                                                                       |

Provider presets and their per-provider overrides are documented in the
[README](../README.md#decision-provider-presets).

## Live versus restart-scoped changes

Everything on the card applies to the running plugin without a restart, with
one exception: `archive.rootPath` is a deployment-only field, because moving
the archive root while shaping runs would split one conversation's originals
across two directories.

## Validation

`resolveJevCompactionConfig` rejects what it cannot express safely: negative or
non-finite sizes, probabilities outside `[0, 1]`, an inverted
`truncateThreshold > fullThreshold`, an unknown provider, and `custom` without
an endpoint. The same resolution runs in the settings section's `validate`
hook, so a bad value is refused before it is persisted. Errors surface in the
card next to the field that caused them.
