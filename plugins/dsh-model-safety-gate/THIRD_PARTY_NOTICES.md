# THIRD_PARTY_NOTICES

This directory-level notice records upstream works whose **ideas** informed
the architecture of `dsh-model-safety-gate`. Following the compliance model
used by `dsh-defend` itself, this plugin **bundles no third-party source
code**: every scanner rule, regex, state machine, and class here is an
independent implementation written for this repository.

| Upstream | License | What was taken | What was not taken |
| --- | --- | --- | --- |
| [dsh-defend](https://github.com/PerryLink/dsh-defend) (PerryLink) | Apache-2.0 | Gate posture on `agent/pre-step`; allow/ask/block mapping on `tools/pre-execute`; bounded scanner budget concept; fail-closed defaults; sanitized metadata-only audit; the idea of porting rule *taxonomies* with attribution | No Apache-2.0 source code, no upstream rule texts, and no upstream rule identifiers (`rh-*`, `ii-*`, `jd-*`) were copied |
| [dsh-run-guard](https://github.com/Dis2017/dsh-run-guard) (Dis2017) | MIT | The technique of wrapping `llm/stream` with an async-generator filter and ending a stopped generation with a synthetic `finish` chunk | No source copied; our wrapper adds per-channel quarantine, rolling windows, and provider cancellation via `agent.cancel` |
| [dsh-autogate](https://github.com/wangxing-git/dsh-autogate) (wangxing-git) | MIT | Deterministic-rules → classifier-model layering; pinning a classifier provider/model or OpenAI-compatible endpoint; timeout + malformed-output failure handling; `<untrusted>` prompt/data separation | No source copied; verdict schema differs (`allow/warn/review/block` + categories + confidence) |
| [dsh-secure-audit](https://github.com/PensiveFei/dsh-secure-audit) (PensiveFei) | MIT | Pluggable model-classifier concept; obfuscation normalization idea (zero-width stripping, lookalike mapping, bounded base64 decoding) | No source copied; our normalization, folding views, and rules are original |
| [dsh-injection-guard](https://github.com/loeanxi/dsh-injection-guard) (loeanxi) | MIT | Source-aware handling of indirect injection: untrusted tool results raise a per-turn risk state that tightens later tool-call decisions | No source copied; our tracker merges by session/turn with escalation-only semantics |

Because no source code was copied, no additional license texts are embedded
beyond this attribution record and the credit in `NOTICE.md` / `README.md`.
The plugin itself is MIT-licensed (see `LICENSE`).
