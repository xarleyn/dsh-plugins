# dsh-l10n-overrides

English localization overrides for DeepSeek Harness plugins.

This repository currently contains the first working foundation: translation
packs are validated and indexed, locale lookups can be overlaid without
replacing the host locale service, and narrowly scoped DOM fallbacks cover text
and selected accessibility attributes.

## Status

The core is implemented and tested, but the package is not ready for a public
release yet. In particular, it still needs integration testing in a real DSH
browser session and real translation packs. See [ROADMAP.md](ROADMAP.md).

## Translation packs

Packs live in `src/packs` and conform to the exported `TranslationPack` type.
Each pack declares its target package, optional compatible version range,
locale-key overrides, and optional exact-match DOM fallback rules.

DOM rules must have a non-empty CSS scope. They are deliberately conservative:
only exact text matches and the `placeholder`, `title`, `aria-label`, and `alt`
attributes are supported.

## Installation

```sh
dsh plugin --profile web add @yadsh/dsh-l10n-overrides
```

## Development

Requirements: Node.js 22 or newer and the pnpm version pinned at the monorepo root.

```sh
pnpm install --frozen-lockfile
pnpm --filter @yadsh/dsh-l10n-overrides check
```

`pnpm check` runs formatting, type checking, tests, production builds, and
package smoke checks. CI runs the same command.

The complete intended behavior and constraints are documented in
[SPEC — dsh-l10n-overrides.md](SPEC%20%E2%80%94%20dsh-l10n-overrides.md).

## License

MIT. This is an independent community project and is not affiliated with or
endorsed by DeepSeek.
