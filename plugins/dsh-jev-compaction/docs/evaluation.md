# Evaluation results — offline corpus (SPEC §33)

Primary quality metric: **dangerous prune rate** (labeled `must-keep`
candidates that the pipeline mutated). Release gates: zero dangerous prunes
on every scenario, clean replay and second-run convergence per scenario, and
average context reduction ≥ 0.55 over the low-danger set.

## Run: shipped defaults, label-scripted backend (2026-09-20)

Runner: `pnpm run eval` (`tests/eval/evaluation.test.ts`), deterministic, no
network. Actions were produced by the real pipeline (collection → features →
state → scripted System One backend → policy → real mutation writer on a real
`Session`), applied through the armed manual path inside an open turn.

| Scenario | Danger | Reduction | Actions |
|---|---|---|---|
| 01-reread-same-file | low | 63.3% | stub, stub, keep |
| 02-edit-invalidates-read | low | 47.5% | stub, keep |
| 03-edit-invalidates-many | medium | 82.4% | 5× stub, keep |
| 04-long-grep | low | 97.1% | truncate |
| 05-grep-cited-later | high | 0.0% | keep |
| 06-test-fail-then-fix | low | 0.0% | keep, keep |
| 07-test-fail-investigating | high | 0.0% | keep |
| 08-unique-api-response | high | 0.0% | keep |
| 09-docs-lookup | low | 95.9% | stub |
| 10-user-constraint-fanout | high | 55.0% | stub, stub, keep |
| 11-long-shell-log | medium | 95.2% | truncate |
| 12-after-summary-checkpoint | medium | 50.9% | stub, keep |

- **Dangerous prune rate: 0 / 44 labeled candidates.**
- **Average reduction, low-danger set: ≈ 80.2%** (gate 0.55).
- Replay after mutation reproduces identical derived messages on all twelve
  scenarios; a second armed pass changes nothing (marker pinning converges).

## Notes

- Scenario 06's old failing run is an *error* result; `preserve.errors`
  pins it regardless of its `safe-to-truncate` label — defense in depth is
  allowed to be more conservative than the label.
- The `high` rows (05, 07, 08, 10) are the corpus's traps: old, large,
  cheap-looking candidates whose `must-keep` grade is protected by the Jev
  score and, for error results, additionally by the pin.
- With the scripted backend these numbers measure the pipeline and policy
  mechanics, not decision-model quality. Decision quality is what the
  hosted-Jev / Jeff replay below measures over the identical corpus.

## Threshold sweep procedure

Run `tests/eval/evaluation.test.ts` with `decisions.fullThreshold` /
`decisions.truncateThreshold` overridden in `evalService`, keeping the
Pareto frontier of (dangerous prune rate, low-danger reduction). The shipped
defaults (0.70 / 0.45) sit on the zero-danger frontier; bias `fullThreshold`
upward before accepting any nonzero dangerous prune rate (SPEC §47).

## Hosted-Jev / Jeff replay (opt-in, requires credentials)

1. Point `decision` at the hosted endpoint (or a local Jeff server).
2. Replace `LabelScriptedBackend` with `SystemOneClient` in the eval runner.
3. Run the corpus; diff per-scenario action grades against the scripted
   baseline. Any `high`-row grade regression of more than one step blocks
   the release until thresholds are re-tuned.
