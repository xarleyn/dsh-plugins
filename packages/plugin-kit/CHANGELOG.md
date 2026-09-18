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