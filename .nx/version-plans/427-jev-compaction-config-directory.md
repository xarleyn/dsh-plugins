---
"@yadsh/dsh-jev-compaction": patch
---

The plugin's configuration is a directory now, and a reader can walk it instead of scrolling it.

`src/config.ts` had grown to 1347 lines: presets, both shapes, the shipped defaults, the clamping primitives, the resolver, the live-configuration helpers and the schema — one file the line budget had been warning about since the threshold moved. It is now `src/config/`: `constants.ts` (endpoint presets, the default-shaped tool names, and the literal unions derived from those same tuples), `types.ts` (the raw and the resolved shape, plus the live one), `defaults.ts`, `validation.ts` (the clamping primitives), `resolve.ts` (normalization), `live.ts` (detaching the loader's volatile references) and `schema.ts` (the Schemastery schema). `index.ts` is the barrel.

The move is line-for-line. Every declaration body is what it was, including the resolver, which was explicitly not rewritten — the only delta is which lines say `export` and which file a name is imported from. Visibility follows the boundary rather than the old file: `detach` and `LiveNodes` never leave their module and stayed private, the clamping primitives are consumed by the resolver and are exported from `validation.ts`. The barrel hands out exactly the names the old file did.

What is unchanged is the whole contract: `src/index.ts`, `src/service.ts` and the browser card import the same identifiers, the schema validates and defaults exactly as before, and `package.json` `exports` never named the old path, so no consumer of the published package calls anything differently. The tarball does carry the new shape — `lib/config/` in place of the single `lib/config.js` — which is the only thing a release diff can point at. Hence `patch`.
