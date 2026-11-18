# Roadmap

## Implemented foundation

- Translation pack contracts, validation, diagnostics, precedence, and lookup.
- Safe interpolation for named and positional placeholders.
- Reversible locale-runtime hook with shared-installation lifecycle handling.
- Scoped, exact-match DOM translation with mutation observation and restoration.
- DSH client composition and module-loader bundle generation.
- Unit, integration, build, and package smoke checks.

## Publication and remaining acceptance

[Version 0.1.13 is published](https://www.npmjs.com/package/@yadsh/dsh-l10n-overrides/v/0.1.13).
The [README](./README.md#installation) documents installation, and
[compatibility.json](./compatibility.json) records the tested Host releases.
The following items track deployment acceptance and translation coverage.

- Run an end-to-end smoke test inside a real DSH browser session, including
  plugin reload and disposal.
- Verify duplicate installations and disposal on real Cordis fibers.
  [Ownership tests](./tests/locale-hook-ownership.test.ts) cover the hook's
  lifecycle with a test runtime.
- Replace the example pack with reviewed translations for actual target plugins
  and record their supported version ranges.
- Use the repository tarball verifier for each release. Record the Host and
  locale-plugin versions with the live browser results.

## Follow-up work

- Add optional settings and debug diagnostics UI.
- Support external or user-authored pack loading after defining a trust model.
- Add more target locales without changing the English-first core semantics.
- The DOM translator split landed in `abcf099d`. Extend the existing
  modules as its rule surface grows.
- Evaluate broader selector and SVG attribute support only with explicit tests;
  the current HTML-oriented scope and attribute rules remain intentional.
