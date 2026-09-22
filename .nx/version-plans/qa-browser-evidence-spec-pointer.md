---
"@yadsh/dsh-qa-browser": patch
---

The product contract names the drafted evidence layer instead of leaving it unreachable.

`docs/specs/evidence.md` (Status: Draft) plans screenshots, console/network/
trace capture, evidence bundles, automatic capture on failure and visual
comparison, but nothing linked it from `SPEC.md`, so the plan behind the
`vision`, `devtools`, `network` and `trace` capability groups could only be
found by already knowing the path. §15.8 now points at it and says exactly how
much of it ships: the viewport `browser_screenshot` slice, with the capture
modes, the layers, the bundle and the comparison still unimplemented — which is
why those groups default to off.
