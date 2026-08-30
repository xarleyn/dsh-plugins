# Repository instructions

## Verification before completion

- Before finishing a task, run the checks relevant to the changed scope.
- For code changes, run the available tests, linter, type checker, build, and
  package or integration verification when applicable. Prefer the repository's
  combined check command when it covers the affected code.
- Do not claim that a task is complete while a relevant check is failing.
  If a check cannot be run, state which check was skipped and why.
- Report the exact verification commands and their results in the final
  handoff.

## Browser client module identity

- Every package that declares `dsh.client` must ship a classic browser bundle
  that registers itself through `window.__ModuleLoader__.load({ id, factory })`.
- The registration `id` must exactly equal the package's full
  `package.json.name`, including its npm scope. Do not use the Cordis patch id,
  the plugin directory name, or an unscoped shorthand.
- Client bundle and packed-package verification must assert the full package
  name. When an integration check fetches a bundle, use
  `/plugins/<full-package-name>/client.js`, preserving the scoped path.
