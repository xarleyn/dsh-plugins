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