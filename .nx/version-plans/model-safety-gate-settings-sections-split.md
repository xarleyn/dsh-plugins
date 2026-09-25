---
"@yadsh/dsh-model-safety-gate": patch
---

The card body is several modules now, and nothing the shell sees changes.

`src/client/sections.tsx` was one 875-line file holding every settings plane of
the Safety Gate card together with the read-only status and verdict views, so a
change to the streaming window sat in the same file as a change to the audit
disclosure. It is now a `src/client/sections/` directory built by the same
tsdown entry: one module per settings plane (`gate`, `input`, `output`, `tools`,
`classifier`, `audit`, `advanced`), `status.tsx` and `verdicts.tsx` for the two
views that only read the running gate, `controls.tsx` for the props and the
clearing button the planes share, and `index.ts` for the surface `card.tsx`
imports. The option lists moved next to the plane that owns them, so an added
mode is edited in the file that renders it. The largest module is 185 lines.

Every choice a section makes is unchanged: the same settings paths are written
and cleared, the same defaults stand in for an absent snapshot, the override
marker and its reset still cover `enabled` with `mode` and `tools` with
`toolResults`, and the remote-classifier and raw-content disclosures appear under
the same conditions. The shell keeps the shared `dsh-plugin-card*` classes and
the SVG chevron, and the built bundle is asserted by `pnpm verify` — no test was
edited.
