## 0.4.1 (2026-09-22)

### 🩹 Fixes

- Five client bundles stop letting a literal decide a surface, a status or an ([54c2bcc](https://github.com/xarleyn/dsh-plugins/commit/54c2bcc))
  elevation (#254).

  The audited rule is the one the guidelines state: UI is built from
  `--dsw-alias-*` tokens, and a literal may only carry a narrow semantic accent.
  Outside `dsh-qa-surface` (excluded by the card), the sweep found two statuses
  and two elevations that broke it:

  - `dsh-domain-experts` defined its own `--dx-ok/--dx-warn/--dx-danger` with hex
    literals, so enforced, advisory and error text kept a fixed green, amber and
    red in every theme. They now resolve to the host's
    `--dsw-alias-state-{success,warn,error}-primary`, which the rest of the
    repository already uses; the local names stay, so no rule changed shape.
  - `dsh-qa-browser`'s canvas and its tab menu carried literal `box-shadow`
    values. They now ask for `--dsw-shadow-lv2`/`--dsw-shadow-lv3` - the tokens
    `dsh-qa-surface` and `dsh-draft-sessions` already use - and keep the previous
    value as the fallback, so an older host renders exactly as before.
  - `dsh-draft-sessions` wrote the same idea as `--dsw-shadow-l2`, a name no host
    defines; the literal fallback hid it, which is why it survived. Corrected to
    `--dsw-shadow-lv2`.
  - `dsh-documents` asked for `--dsw-label-tertiary` first and only fell back to
    the token that exists; the dead first name is gone.
  - `dsh-doc-impact`'s transparent button border was spelled `#0000`; the keyword
    `transparent` says the same thing without a color literal.

  What stayed is what the rule allows: the remaining literals in these bundles are
  all fallbacks inside `var(<token>, <literal>)`, never the value a themed host
  would resolve. Typography literals were deliberately not touched - the canonical
  card shell in AGENTS.md hardcodes its own 15/13/11px sizes, so font sizes are
  the repository's convention rather than a token-governed surface.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.4.0 (2026-09-21)

### 🚀 Features

- The steering messages and the steering itself are operator-configurable. ([f946a3d](https://github.com/xarleyn/dsh-plugins/commit/f946a3d))

  The reminder the plugin steers into the turn and the final limit notice were
  literal strings in the source, so rewording one meant editing the package.
  Both texts are now settings: `reminderTemplate` with the `{intro}`, `{count}`,
  `{body}` and `{tail}` placeholders (the generated impact list stays `{body}`
  and is required), and `limitTemplate` with `{rounds}` and `{impacts}`. An
  empty template or one that dropped the required placeholder falls back to the
  built-in wording, which reproduces the previous messages exactly, and the
  settings card edits both texts in textareas with the placeholders documented
  inline.

  The new `steer` switch (default `true`) stops the plugin from steering
  reminders while everything else keeps working: impacts are still detected and
  reported through the tools and `/doc-impact`, reminder rounds are not spent,
  and re-enabling starts from a clean slate instead of instantly hitting the
  round limit.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.3.3 (2026-09-17)

### 🩹 Fixes

- Internal cleanup: the client-bundle gate now asserts the ModuleLoader registration (window.__ModuleLoader__.load) explicitly next to the factory id. No runtime changes. ([73113f3](https://github.com/xarleyn/dsh-plugins/commit/73113f3))

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.0
- Updated @yadsh/dsh-plugin-kit to 0.2.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.3.2 (2026-09-15)

### 🩹 Fixes

- Reformat the package with the repository's shared Prettier configuration. The ([ddba2dd](https://github.com/xarleyn/dsh-plugins/commit/ddba2dd))
  config now lives in the repository root instead of inside four packages, and
  this sweep brings every package to it. Formatting only — no behavior and no API
  change beyond the reformatted sources in the published tarball.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.3.1

### ❤️ Thank You

- xarleyn @xarleyn

## 0.3.1 (2026-09-13)

### 🩹 Fixes

- Fix the settings card never mounting in the web UI. The 0.1.5 client ([39d397b](https://github.com/xarleyn/dsh-plugins/commit/39d397b))
  runtime exposes only the services a module declares in `inject`, and the
  client bootstrap still read `settingsScope` and `locale` through the
  0.1.1-era `ctx.get` indirection, saw them as absent, and silently skipped
  the `settings.plugin.item` card registration. The services are now
  declared and read as context properties like every other card.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.3.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.3.0 (2026-09-12)

### 🚀 Features

- Port to the DSH session format v3: the tool context now derives from the ([6d2ba6a](https://github.com/xarleyn/dsh-plugins/commit/6d2ba6a))
  host ToolRunContext and reads the raw log via session.snapshotEvents()
  instead of the removed session.events. The supported host range moves to
  >=0.1.5-rc.2 <0.2.0, dropping 0.1.1-rc.2.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.4 (2026-09-06)

### 🩹 Fixes

- Prevent slot mutation while inference streams are active, validate llama.cpp ([f97114e](https://github.com/xarleyn/dsh-plugins/commit/f97114e))
  management responses, use the shared DSH home, make correction truncation
  Unicode-safe, bound miner retention and pending state, restore strict host
  type checking for session scope, pause UI polling in hidden tabs, and align
  published package metadata, compatibility declarations, and build lifecycle
  gates.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.2.1

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.3 (2026-08-31)

### 🩹 Fixes

- Add shared structured plugin logging and its settings UI, expose session-scope ([cea45a5](https://github.com/xarleyn/dsh-plugins/commit/cea45a5))
  reads through the remote API, and align plugin configuration cards with the
  native DSH settings UI. Preserve asynchronous KV streams while migrating
  logging consumers to the shared package.

- Build the browser client from TypeScript with tsdown while preserving the ([3e0ac46](https://github.com/xarleyn/dsh-plugins/commit/3e0ac46))
  classic ModuleLoader bundle and plugin settings-card contract.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.2.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.2 (2026-08-30)

### 🩹 Fixes

- Adopt the @yadsh scope, import the real plugin suite, and standardize monorepo build, validation, and release infrastructure. ([dce0a77](https://github.com/xarleyn/dsh-plugins/commit/dce0a77))

### ❤️ Thank You

- xarleyn @xarleyn