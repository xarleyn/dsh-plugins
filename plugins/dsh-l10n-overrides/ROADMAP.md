# Roadmap

## Implemented foundation

- Translation pack contracts, validation, diagnostics, precedence, and lookup.
- Safe interpolation for named and positional placeholders.
- Reversible locale-runtime hook with shared-installation lifecycle handling.
- Scoped, exact-match DOM translation with mutation observation and restoration.
- DSH client composition and module-loader bundle generation.
- Unit, integration, build, and package smoke checks.

## Required before the first public release

- Run an end-to-end smoke test inside a real DSH browser session, including
  plugin reload and disposal.
- Harden duplicate installation under real Cordis fibers: keep locale listeners
  owned per fiber, DOM translators per document, and prevent a partially drained
  installation from being leased again.
- Replace the example pack with reviewed translations for actual target plugins
  and record their supported version ranges.
- Verify the packed npm tarball contents and imports from a clean consumer
  project, not only from the repository build output.
- Confirm compatibility against the supported DSH and locale-plugin versions.
- Document installation and enablement once the real DSH loading path is
  verified.

## Follow-up work

- Add optional settings and debug diagnostics UI.
- Support external or user-authored pack loading after defining a trust model.
- Add more target locales without changing the English-first core semantics.
- Split the DOM translation engine into smaller parsing, matching, and ownership
  modules as its rule surface grows.
- Evaluate broader selector and SVG attribute support only with explicit tests;
  the current HTML-oriented scope and attribute rules remain intentional.
