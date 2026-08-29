# dsh-l10n-overrides

[![CI](https://github.com/xarleyn/dsh-plugins/actions/workflows/ci.yml/badge.svg)](https://github.com/xarleyn/dsh-plugins/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40yadsh%2Fdsh-l10n-overrides.svg)](https://www.npmjs.com/package/@yadsh/dsh-l10n-overrides)
[![npm downloads](https://img.shields.io/npm/dm/%40yadsh%2Fdsh-l10n-overrides.svg)](https://www.npmjs.com/package/@yadsh/dsh-l10n-overrides)
[![Node.js](https://img.shields.io/node/v/%40yadsh%2Fdsh-l10n-overrides.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Runtime localization overrides for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugins.

`dsh-l10n-overrides` overlays missing or incorrect locale entries without replacing the host locale service. Translation packs can also provide narrowly scoped DOM fallbacks for text and selected accessibility attributes.

[Specification](SPEC.md) · [Roadmap](ROADMAP.md)

## Installation

The package is not published yet. Build and install it from a local monorepo checkout:

```bash
pnpm --filter @yadsh/dsh-l10n-overrides build
dsh plugin --profile web add ./plugins/dsh-l10n-overrides
```

Once a public release is available, install it by package name:

```bash
dsh plugin --profile web add @yadsh/dsh-l10n-overrides
```

To remove the plugin:

```bash
dsh plugin --profile web remove @yadsh/dsh-l10n-overrides
```

Restart the DeepSeek Harness host if bundle hot reload does not pick up the newly installed browser client.

## What works now

- validated and indexed translation packs;
- locale-key overlays that preserve the host locale service;
- optional package-version compatibility ranges;
- exact-match DOM fallbacks for text content;
- scoped fallbacks for `placeholder`, `title`, `aria-label`, and `alt` attributes;
- package and browser-bundle verification.

The implementation is tested, but it is not considered ready for a public release until it has real translation packs and integration coverage in a live DSH browser session. See the [roadmap](ROADMAP.md).

## Translation packs

Packs live in `src/packs` and conform to the exported `TranslationPack` type. Each pack declares its target package, optional compatible version range, locale-key overrides, and optional exact-match DOM fallback rules.

DOM rules must use a non-empty CSS scope. They are deliberately conservative: substring and regular-expression replacements are not supported, and fallback rules only touch explicitly supported text or accessibility attributes.

## Requirements

- Node.js `^22.19.0` or `>=24.0.0`
- pnpm 10.4.1 for development
- DeepSeek Harness `>=0.1.1-rc.2 <0.2.0`
- Cordis `^4.0.1`

## Development

From the monorepo root:

```bash
pnpm install --frozen-lockfile
pnpm --filter @yadsh/dsh-l10n-overrides check
```

The package check runs formatting, type checking, tests, production builds, and package smoke checks. CI runs the same quality gate through the monorepo.

## Releases

This package uses independent Nx Version Plans from the monorepo. Add a plan with `pnpm release:plan`; maintainers publish verified tarballs through the shared [release workflow](../../docs/RELEASING.md).

## Contributing

Issues, translation packs, and focused pull requests are welcome. Read the monorepo [contribution guide](../../CONTRIBUTING.md) and run the package check before submitting a change.

## License

[MIT](LICENSE). This is an independent community project and is not affiliated with or endorsed by DeepSeek.
