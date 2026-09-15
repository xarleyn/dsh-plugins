# Upstream sync

How to bring a later revision of OpenViking's `@openviking/dsh-memory-plugin`
into this fork.

The fork is not meant to become a permanently detached copy: upstream fixes DSH
compatibility, follows the harness's release candidates, and adjusts the
OpenViking API surface. Those changes are worth having. The fork's own injection
controls are not upstream's, so a blind directory overwrite would delete them.

Current provenance (repository, package, path, commit, version, import date,
licence) is recorded in [../UPSTREAM.md](../UPSTREAM.md). Read it first — it also
lists what was dropped during the initial port, so an upstream change to one of
those helpers does not look like a regression.

## Process

1. **Determine the current imported upstream SHA.** It is the `Imported from
   commit` line in `UPSTREAM.md`.
2. **Fetch newer upstream.** The plugin lives at
   `examples/dsh-memory-plugin`; the shared library it is generated from lives at
   `examples/memory-plugin-shared/lib`. Read both — a change may land in the
   shared library and only be copied into the plugin afterwards.

   ```bash
   git clone --filter=blob:none --no-checkout https://github.com/volcengine/OpenViking.git /tmp/openviking
   cd /tmp/openviking
   git log --oneline <imported-sha>..HEAD -- examples/dsh-memory-plugin examples/memory-plugin-shared
   ```

3. **Review the commits** that touch the package or the shared memory code.
   Classify each one:
   - **bug fixes** — usually portable as-is;
   - **DSH compatibility fixes** — must be checked against the pinned DSH
     release in `compatibility.json`; upstream supports a wider range and may
     fix a version this fork does not target;
   - **OpenViking API changes** — land in `src/client.ts` and
     `src/openviking/recall-core.ts` and usually need a request/response review;
   - **behaviour changes** — decide deliberately whether the fork follows;
   - **generated/shared changes** — compare `examples/memory-plugin-shared/lib`
     with the vendored copy, do not assume the plugin directory is the source of
     truth.
4. **Port the relevant changes by hand**, into the TypeScript modules under
   `src/`. Keep the `@yadsh` types, the structured logging and the `.js` import
   specifiers.
5. **Never overwrite the `@yadsh`-specific behaviour**: the four injection
   controls, `resolveInjectionPlan` and the `profileWanted()` gate in
   `src/runtime.ts`, the fail-loud config schema, and the `Service`-based entry.
   If an upstream change touches the same code path, merge it into the fork's
   shape rather than replacing it.
6. **Add the dropped-helper policy to the diff review**: if upstream starts
   using a helper this port dropped (for example `extractCaptureTurns`), port
   that helper too.
7. **Run the parity and injection suites**:

   ```bash
   pnpm nx run @yadsh/dsh-openviking-memory:test
   pnpm nx run @yadsh/dsh-openviking-memory:typecheck
   pnpm nx run @yadsh/dsh-openviking-memory:verify
   ```

   The injection matrix (`tests/injection.test.ts`) is the gate that catches an
   upstream change which would reintroduce an unconditional profile or recall
   request.
8. **Update `UPSTREAM.md`** with the new SHA, version and date, and extend the
   "Local modifications" list if the port needed new edits.
9. **Add a changelog entry** through the normal Nx Version Plan, naming the
   upstream revision that was synced, so a future reader can tell a fork feature
   from an upstream fix.

## What not to do

- Do not copy the upstream `.mjs` tree over `src/`.
- Do not sync an upstream change that widens the supported DSH range without
  updating `compatibility.json`, `docs/COMPATIBILITY.md` in the repository root,
  and the README.
- Do not treat "upstream has a test for it" as a reason to port the test
  verbatim; port the behaviour and write the assertion in this repository's
  style.
