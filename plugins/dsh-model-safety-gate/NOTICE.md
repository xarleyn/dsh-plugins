# NOTICE

`dsh-model-safety-gate` is an independent implementation. Its architecture
follows ideas proven by several earlier DeepSeek Harness plugins; no source
code was copied from any of them. Upstream references are kept here as the
license-attribution and provenance record required by the design document
(design SPEC §2).

Architectural inspiration:

- [dsh-defend](https://github.com/PerryLink/dsh-defend) by
  [PerryLink](https://github.com/PerryLink) (Apache-2.0) — the authoritative
  `agent/pre-step` gate posture, the allow/ask/block decision mapping on
  `tools/pre-execute`, bounded head-only scanning, fail-closed semantics, and
  sanitized metadata-only audit. Rule taxonomies (injection / jailbreak /
  secret families) were ported as ideas with fresh, independent
  implementations; no Apache-2.0 source, rule text, or rule identifiers were
  copied.
- [dsh-run-guard](https://github.com/Dis2017/dsh-run-guard) by
  [Dis2017](https://github.com/Dis2017) (MIT) — the proof that wrapping
  `llm/stream` with a filtered async generator and stopping generation with a
  synthetic terminal finish works in practice.
- [dsh-autogate](https://github.com/wangxing-git/dsh-autogate) by
  [wangxing-git](https://github.com/wangxing-git) (MIT) — the
  deterministic-rules → separate-classifier-model flow, classifier
  provider/endpoint pinning, timeout and malformed-output handling, and
  clean-context `<untrusted>` prompt/data separation.
- [dsh-secure-audit](https://github.com/PensiveFei/dsh-secure-audit) by
  [PensiveFei](https://github.com/PensiveFei) (MIT) — the pluggable
  model-classifier idea and obfuscation normalization (zero-width stripping,
  lookalike mapping, bounded base64 candidates).
- [dsh-injection-guard](https://github.com/loeanxi/dsh-injection-guard) by
  [loeanxi](https://github.com/loeanxi) (MIT) — source-aware indirect-injection
  handling: untrusted tool results raise a per-turn risk state that tightens
  subsequent tool-call decisions.

This plugin's implementation — the two-view Unicode folding pipeline, the
quoted-span false-positive downgrade, the per-channel quarantine state
machine, the classifier bypass marker, the strict verdict schema, and the
audit/metrics layer — is original to this repository (MIT, see LICENSE).
