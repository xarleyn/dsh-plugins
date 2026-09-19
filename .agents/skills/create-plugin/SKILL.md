---
name: create-plugin
description: Scaffold and ship a new DSH plugin in this monorepo — generator,
  manifest and gates, host-side (cordis/tools/storage/typert) and client-side
  (ModuleLoader bundle/cards/tokens) traps, version plans and the release flow.
  Use when the user asks to create/add/scaffold a plugin ("создай плагин",
  "новый плагин", "add a plugin", "new DSH plugin"), or when wiring a new
  package under plugins/.
---

# Create a DSH plugin

This monorepo already enforces most of the contract through gates, and
`docs/PLUGIN_GUIDELINES.md` (RU) is the canonical narrative guide. This skill
is the operational path: what to run, in which order, and the traps the gates
do NOT catch. When this skill and PLUGIN_GUIDELINES disagree, check git history
and prefer the newer rule.

## The fast path

1. **SPEC first, before code.** One `SPEC.md` in the plugin root is the
   product contract (guidelines §8.2): what the plugin does, its config
   surface, its tool names, degradation behavior. Later design docs go to
   `docs/specs/<topic>.md` (kebab-case topic, no plugin name in the file
   name), working notes to `docs/INVESTIGATE.md`.
2. **Scaffold with the generator** (it encodes the canonical metadata):

   ```bash
   pnpm nx g @yadsh/dsh-plugin-generator:dsh-plugin <name> --client --description="..."
   ```

   `<name>` is kebab-case, with or without the `dsh-` prefix; the directory
   becomes `plugins/dsh-<name>`, the npm name `@yadsh/dsh-<name>`. `--client`
   adds the browser entry (`src/client/index.tsx` → `lib/client.js`), the
   tsdown config with the ModuleLoader banner, and
   `scripts/verify-client-bundle.mjs`.
3. **Fix what the generator does not do** (see "After the generator").
4. **Build in dependency order, then run the plugin's own loop.** In a fresh
   checkout or worktree, `packages/*` are not built and nx lies about it —
   see `references/release-and-gates.md` §Build order.
5. **Verify like CI, commit as one feature.** Commands in
   `references/release-and-gates.md`; commit conventions at the end of this
   file.

## After the generator — mandatory manual work

- `README.md`: the install command must carry the required `--profile` flag —
  the CLI rejects a bare `dsh plugin add`:
  - host-only plugin: `dsh plugin --profile <profile> add @yadsh/dsh-<name>`
  - plugin with `dsh.client`: `dsh plugin --profile web add @yadsh/dsh-<name>`
- `dsh.client` is scaffolded as `{ platform: "web" }` only. Real plugins also
  declare (see `plugins/dsh-model-safety-gate/package.json` as the reference):
  - `inject`: harness client packages whose face the plugin's client code
    imports (e.g. `@deepseek-ai/dsh-client-ui-settings` for a settings card,
    `@deepseek-ai/dsh-client-connection`);
  - `external`: packages that stay out of the bundle because the host page
    provides them (React, `@deepseek-ai/dsh-client-ui-slots`) — mirror the
    same ids in `tsdown.config.ts` `deps.neverBundle`.
- `compatibility.json`: add `requiredHostFeatures` when known (e.g.
  `["tools/register"]` for a tool plugin); `node` must equal `engines.node`
  verbatim — the hygiene gate compares the strings.
- `scripts/verify-package.mjs`: extend the scaffold with plugin-specific
  asserts (card contract, design tokens, no Node builtins in the client
  bundle). References: `plugins/dsh-git-readonly` (host-only),
  `plugins/dsh-model-safety-gate` (client card),
  `plugins/dsh-qa-surface` (host+client+typert). The thin wrapper over
  `packages/plugin-scripts/run-verify-package.mjs` is the established shape —
  do not accept audit reports that call these wrappers "duplicates".
- Config surface: Schemastery schema (user-facing contract, exported via the
  Cordis `Config` convention) plus a resolve function that normalizes and
  clamps raw config, so tools never see optional fields or unsafe limits —
  `plugins/dsh-git-readonly/src/config.ts` is the pattern. JSDoc every field.
- Tests: config resolution, the main scenario, dispose symmetry, degradation
  (guidelines §6.2). Keep test files under ~400 lines and split by domain —
  the repo has already paid down every monolith above that size.
- Version plan `.nx/version-plans/<topic>.md` — required for ANY change of a
  publishable package, including the first release (format below).
- `pnpm plugins:manifest` — regenerates the root `plugins.json`; the hygiene
  gate fails on drift.
- Root `README.md` (package table) and `docs/COMPATIBILITY.md` (peer matrix) —
  new-plugin checklist items (guidelines §10.1).

## Traps the gates do not catch

Full details with symptoms and fixes in the references. The short list, in
order of how often they bite:

- **`lib/` staleness.** typert and card-contract verifiers read the BUILT
  `lib/`. Stale `lib/` gives false green and false red; fresh checkout gives
  `TS2307` that local runs hide. Build before verify; on any new typert method
  rebuild `lib/types` before typecheck. See `references/release-and-gates.md`.
- **cordis service capture.** `ctx.get("x")` in a constructor returns
  `undefined` until the provider fiber is ACTIVE — and stays dead forever.
  Read services per call, or declare hard `inject`. There is no optional
  inject form in this cordis version: optional dependency = per-call
  `ctx.get(...) as T | undefined`. See `references/host-side.md`.
- **Client bundle platform.** The bundle loads in a sandboxed ModuleLoader:
  any `require("process")` / Node builtin (including a transitive `yaml` node
  build) kills the whole plugin surface in the browser while `pnpm check`
  stays green and the host log stays empty. Check the transitive closure from
  `src/client/index.tsx`, not just `src/client/**`. See
  `references/client-side.md`.
- **Client `inject` contract.** Reading `ctx.remote.<ns>` or any client
  service without listing it in the face's `inject` throws
  `cannot get property … without inject`, the loader entry dies, the plugin
  vanishes from the UI — and the host log is clean. Unit tests cannot catch
  this class; keep an honest smoke and verify on a live rig. See
  `references/client-side.md`.
- **typert is stricter than tsconfig.** `exactOptionalPropertyTypes` applies
  at build (generate-typert), so `field?: T` + conditional spread +
  `Partial<>` in DTOs all pass typecheck and fail build. Public members need
  explicit type annotations; DTO types must live in the package's own
  `src/`. See `references/host-side.md`.
- **Session journal events.** Never write custom event types into the session
  journal: the reader rejects unknown types not marked `ignorable`, and
  `Session.append` cannot set the marker — the journal becomes unreadable by
  any build without the plugin (this is why qa-surface and safety-gate moved
  provenance to their own stores). See `references/host-side.md`.
- **Design tokens.** An unknown `var(--dsw-…)` silently invalidates the whole
  CSS declaration — invisible text, missing borders, no error anywhere. Use
  only token names that exist in the DSH theme; the known-dead list and the
  token-gate recipe are in `references/client-side.md`.
- **Leak rules (public repo, npm-published).** Examples and fixtures use only
  synthetic placeholders (`PROJ-123`, `jira.example.corp`); a number is part
  of the identifier; `lib/` strings are model-visible and ship to npm; release
  notes must not reveal that something was removed. Grep marker classes before
  committing (AGENTS.md «No internal identifiers in public content»), and run
  the local leak scanner before releases if it is available.

## Version plan (first release and every later change)

`.nx/version-plans/<kebab-topic>.md`:

```markdown
---
"@yadsh/dsh-<name>": minor
---
One-paragraph changelog entry: what the user gets, neutral wording.
```

Rules: the `---` fence is mandatory (without it Nx silently ignores the file);
one plan per package, several plans merge into the highest bump; the plan is
what nx turns into the version bump and CHANGELOG entry — a missing plan means
your feature silently never appears in the changelog; uncommitted changes are
invisible to `pnpm release:check` (it reads commits); for `dsh-qa-surface`
plans, `QaChangelog.tsx` must gain a newer curated entry in the same change
(the hygiene gate enforces this). Validate with `pnpm verify:packages`.

## Commit conventions

- One feature = ONE big `feat(dsh-<name>): …` commit carrying code, tests,
  gate updates, README/SPEC, the version plan, and regenerated `plugins.json`.
  Docs-only work is a separate `docs(dsh-<name>): …`. Do not split
  code/tests/docs; do not use the `!:` breaking marker (bump via the plan,
  explain the break in the commit body).
- There are no git hooks here: a green commit proves nothing by itself — run
  the gates before committing.
- Stage explicit paths only (`git add plugins/dsh-<name> …`): the tree almost
  always carries someone else's uncommitted WIP, and `git add -A` will take it.

## References

- `references/host-side.md` — cordis semantics, config, tools, storage,
  subagents, typert/Remote, testing recipes.
- `references/client-side.md` — ModuleLoader bundle identity, platform
  limits, remote namespaces, slots, settings cards, design tokens.
- `references/release-and-gates.md` — gates map, build order, pre-push
  command set, packaging/docs layout, release mechanics.
- Canonical docs: `docs/PLUGIN_GUIDELINES.md`, `docs/VERIFICATION.md`,
  `AGENTS.md`, `docs/RELEASING.md`.
