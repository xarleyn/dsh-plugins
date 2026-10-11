## 0.5.0 (2026-10-04)

### 🚀 Features

- A settings card routed through the kit's helper reaches the Plugins panel row now. ([#694](https://github.com/xarleyn/dsh-plugins/issues/694), [#684](https://github.com/xarleyn/dsh-plugins/issues/684), [#647](https://github.com/xarleyn/dsh-plugins/issues/647), [#659](https://github.com/xarleyn/dsh-plugins/issues/659))

  `registerSettingsCard` and `registerSettingsSlot` mounted a card that named no
  `slotName` into `settings.plugin.item` — the keyed seat the Host deleted in
  `0.1.7`. Registering into a seat that no longer exists throws nothing: the card
  was drawn nowhere, neither on the plugin's row nor in Settings. The default is
  `plugins.row.config` now, the keyed seat of the bundle's own row on the Host's
  Plugins panel, which is where a plugin's configuration card belongs. The constant
  took the same rename, `PLUGIN_ROW_CONFIG_SLOT`, so the published surface stops
  naming a seat that is gone.

  Breaking for a consumer that imported `SETTINGS_PLUGIN_ITEM_SLOT`; no package of
  this repository did. A plugin that passes `slotName` behaves exactly as before,
  and one seated on a surface it must frame itself — `settings.section`,
  `settings.plugins.tab` — still names that seat, and `CardShell`,
  `PLUGIN_CARD_SHELL_CSS` and `ChevronDown` stay published for those two cards. A
  row card passing no `styles` is the point: the panel draws the frame, the heading
  and the expand control, so our shell there would be a second card inside the
  Host's.

  The row seat is keyed `<package name>#<row id>` rather than by a bare namespace,
  and `SettingsCardOptions.key` now says so — the same string is the namespace the
  Host resolves the plugin's volatile Config under, so a value saved before this
  change still reads back through it. Moving the seat without checking the key
  would have left the same silent failure one field over, so both registration
  helpers now throw at the call when the row seat is handed a key that is not that
  composite, or styles that declare the `dsh-plugin-card` shell next to the frame
  the panel already draws. A consumer that hit either case drew no card and said
  nothing; it now says what the seat asks for.

  The bump is `minor`, not `major`: below `1.0` that is the step this repository
  takes for a break, since `major` on a `0.4.0` package publishes `1.0.0` rather
  than announcing anything.

  `@yadsh/dsh-qa-surface` carries the same story in its spec. Section 12.3 told a
  reader to register the settings card into the keyed slot this release deleted,
  with the settings namespace as a bare `key`; the section now names the seat the
  bundle actually takes — a `settings.plugins.tab` page identified by that
  namespace — and says what a card seated on the Plugins panel row does instead.
  `SPEC.md` is outside the package's `files`, so nothing an install reads changes,
  which is why that half is `patch`.


### 🩹 Fixes

- Every publishable library under packages/ now carries a gate of its own. ([#293](https://github.com/xarleyn/dsh-plugins/issues/293))

  Each of the four gained a `verify` target that holds the promises packing cannot
  check: `main` and `types` name the same file as the root export, every declared
  subpath is built, and every published dependency range resolves for a consumer
  that installs from the registry — a `workspace:` range never names a private or
  missing member, a `catalog:` range never names a member at all, and a member is
  never declared as a plain range. `README.md` and `LICENSE` are pinned on disk,
  because the tarball gate that asks for them by name covers plugins only. The
  package hygiene gate requires the target to stay and reads the call itself, so a
  library that loses its gate — or keeps the script while dropping one of the two
  checks — fails locally and in CI instead of shipping unchecked.

- The package inherits the shared TypeScript preset by its path inside the workspace ([#687](https://github.com/xarleyn/dsh-plugins/issues/687), [#688](https://github.com/xarleyn/dsh-plugins/issues/688))
  instead of by its package subpath, which is what lets its test suite compile at all
  on Windows.

  Vite lowers TypeScript with the tsconfig `rolldown` resolved, and that resolver
  walks `extends` through the `node_modules/@yadsh/dsh-config` workspace link while
  folding a relative hop against the link rather than against its target. The preset
  `tsconfig/base` extends the repository's root config, so inheriting it by subpath
  sent the search for that root config outside the tree —
  `node_modules/tsconfig.base.json`, which is not there — and every test file of the
  package failed before a single assertion ran. `tsc` canonicalises the same path and
  never sees the defect, so `build`, `typecheck` and the shipped bundle stayed green
  over a red suite; a POSIX resolver folds `..` along the already-resolved path, so
  the mirror run on Linux was green on the same commit.

  Nothing about the compiler options changes: the two forms resolve to the same
  preset, checked by comparing `tsc --showConfig` before and after. The published
  tarball carries `lib/`, `README.md` and `LICENSE` only, and the tsconfig is not
  among them, so the artifact is byte-identical. `@yadsh/dsh-test-kit` and the plugin
  generator made the same move but are private and need no plan. No runtime change.

- State in the package entry point that the kit is published rather than private: ([#363](https://github.com/xarleyn/dsh-plugins/issues/363))
  plugins import it at runtime, which is what makes it publishable.

- The Safety Gate settings card now takes the frame the Plugins page already draws. ([01f985b1](https://github.com/xarleyn/dsh-plugins/commit/01f985b1))

  Its row on the Plugins panel is seated inside the page's own card: the page paints the
  surface, the heading, the row id and the expand control, and only then mounts the
  bundle's body. Until now the bundle drew a second card around its own settings — a
  12 px rounded rectangle with our chevron, inside the page's 20 px one — so the gate's
  row read as a nested panel next to first-party rows. The body arrives directly: the
  configuration sections are mounted without a shell of ours, without the injected shell
  stylesheet, and without a show/hide button that duplicated the page's own toggle. The
  live mode and the block counters were already in the status section, so the header
  badge that repeated them is gone with the header.

  Focus rings come from the Host's design system now
  (`--dsw-focus-ring-width` / `--dsw-focus-ring-color`) instead of a hard-coded outline.
  `focus.css` of the Host suppresses an outline under pointer modality at a higher
  specificity than our rule, so the previous ring could paint transparent after a mouse
  click; taking the tokens is what the first-party cards do.

  Nothing about the settings themselves moved. The row seat stays keyed
  `@yadsh/dsh-model-safety-gate#dsh-model-safety-gate`, and that key is also the namespace
  the Host resolves the volatile Config under, so every value saved before this change
  still reads back and writes to the same path.

  Decided by the maintainer on 2026-10-01 as option 1 of the card-shell question in
  `docs/DSH-0.1.7-MIGRATION.md` §4.3; the same change is being applied to the other plugin
  cards that register on this row.

  `@yadsh/dsh-plugin-kit` ships unchanged code — its shell and chevron stay for the cards
  that still own one — but its package gate now calls `verifyCanonicalShell` instead of the
  seat-aware dispatcher, because the kit publishes the shell that others inline and
  registers on no seat itself. The bump is for that gate change, matching how
  `shared-package-verify-gates` treated the same situation.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.1

### ❤️ Thank You

- qoder-bot
- xarleyn @xarleyn

## 0.4.0 (2026-09-24)

### 🚀 Features

- A SQLite store can now say what it did to its file. ([17dda2f](https://github.com/xarleyn/dsh-plugins/commit/17dda2f))

  `SqliteDatabase` already owned the parts a store must not get wrong on its own:
  WAL, one-time migrations, a schema version, a refusal to open a database a newer
  build wrote. What it never reported was any of that happening. A schema step that
  ran at start left no trace, so an operator reading a stand's logs afterwards
  could not tell which database was opened, at which version, or whether this
  start applied a migration at all — and the refusal, the one case where the store
  knows it is about to leave a deployment without data, was visible only if the
  caller chose to log the exception.

  The constructor now takes an optional third argument: the plugin's own
  `@yadsh/dsh-plugin-log` logger and a `label` that distinguishes two databases of
  one plugin in one log. An open writes the file, the schema version reached and
  the migration versions it applied; a refusal is recorded before it is raised.
  The argument is optional exactly because eleven stores already call this
  constructor with two arguments — they keep behaving as before, silently, until
  their plugin passes a logger.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.3.0 (2026-09-18)

### 🚀 Features

- Add the shared credential-help contract and the note a settings card renders ([f2544cb](https://github.com/xarleyn/dsh-plugins/commit/f2544cb))
  next to the field that asks for a token.

  A card that asks for a secret without saying where the secret comes from sends
  the user out of the application: to the vendor's developer pages, to work out
  which kind of token is wanted, which permissions it needs, and what exactly to
  paste back. `CredentialHelp` is the metadata that answers those questions — the
  credential mechanism (`api-key`, `personal-access-token`, `oauth`,
  `service-account`, `app-password`, `custom`), where the credential is obtained,
  which documentation describes the authorization, the required permissions and
  the steps to follow. It is metadata and nothing else: the shape has no field a
  credential value, a snapshot or an authorization result could travel in, which
  is what lets it be rendered for a browser that is never given the secret.

  The contract module carries no imports, so the same file serves host code that
  declares the defaults and a browser bundle that renders them.
  `sanitizeCredentialHelpUrl` keeps only `http(s)` — `http:` for loopback, private
  and self-hosted hosts, never an address with a credential inside, and never
  `javascript:`, `data:` or `file:`. `resolveCredentialHelp` merges what an
  integration declares with what its deployment overrides, and reports what the
  override got wrong instead of failing: a broken address hides its own link,
  because help must never be a runtime dependency of the connection.

  On the client side `CredentialHelpNote` renders the trigger and its disclosure
  panel, `credentialHelpView` turns metadata into the view, and
  `CREDENTIAL_HELP_CSS` carries the rules — canonical `--dsw-alias-*` tokens only,
  like the card shell. The note is slot-agnostic: it fits a plugin settings card,
  a feature-owned tab, and the Models page's provider cards. When there is no
  metadata it renders nothing at all, and the plain credential field stays what it
  was.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.0 (2026-09-17)

### 🚀 Features

- Publish the kit as a runtime dependency for plugins, and give it the shared ([7cca749](https://github.com/xarleyn/dsh-plugins/commit/7cca749))
  SQLite store plumbing.

  The kit was `private: true` and absent from the release projects, which was
  correct while everything that imported it ended up inlined: client bundles
  bundle it at build time. A host module that a published plugin imports is
  resolved from `node_modules` at install time instead, so the kit is now a
  publishable package and joins `packages/plugin-log` in the release projects.

  `SqliteDatabase` is what that host module needed. Plugin stores are records
  plus append-only audit logs, and keeping them as JSON documents makes every
  mutation read, parse and rewrite the whole history — the cost of a write grows
  with everything ever written, on paths that run per turn or per tool call.
  Opening the same data as tables makes a write touch only the rows it changes.
  The helper owns WAL (so a plugin's CLI can write the same file from a second
  process), a `BEGIN IMMEDIATE` transaction wrapper, a schema version with
  one-time migrations, a refusal to open a database written by a newer build, and
  chmod 0600, because credential material lives in these files.

  Two plugins need it — `dsh-qa-surface` for its accounts, roles and quality
  stores, and `dsh-qa-integrations` for its registry and audit trail — which is
  why it lives here rather than in either of them, as §27.1 of the monorepo spec
  intends. Nothing imports it yet: the stores move onto it next, so this release
  must reach the registry before a plugin that depends on it at runtime is
  deployed.

### ❤️ Thank You

- xarleyn @xarleyn