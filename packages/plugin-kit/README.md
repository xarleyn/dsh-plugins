# @yadsh/dsh-plugin-kit

Shared runtime helpers for DeepSeek Harness plugins.

The kit is published to npm so that a plugin's host code can import it at
runtime. Its `./client` half is inlined into each plugin's tsdown client
bundle, which keeps published browser bundles self-contained.

## Features

- Configuration validation (`validateConfig`)
- Credential help metadata: the `CredentialHelp` contract a provider declares
  for the field that asks for a token or key — the credential mechanism
  (`kind`), where the credential is obtained, which documentation describes the
  authorization, the required permissions and the steps to follow. The contract
  itself (`resolveCredentialHelp`, `sanitizeCredentialHelpUrl`,
  `CredentialHelpOverride`) is metadata only: it never carries a credential
  value, a snapshot or an authorization result, and it carries no imports, so
  the same module is used by host code and by a browser bundle. Two rules come
  with it: only `http(s)` addresses survive sanitizing (`http:` only for
  loopback, private and self-hosted hosts, and never with a credential or
  `javascript:`/`data:`/`file:` inside), and a deployment overrides any field
  per provider without touching the stored credential.
- `SqliteDatabase`: SQLite plumbing for stores that outgrow a JSON document —
  records plus append-only audit logs that would otherwise be read, parsed and
  rewritten whole on every mutation. The helper owns WAL (so a plugin's CLI can
  write the same file from a second process), a `BEGIN IMMEDIATE` transaction
  wrapper, a schema version with one-time migrations, a refusal to open a
  database written by a newer build, and `chmod 0600`, because credential
  material tends to live in these files. Requires Node's built-in `node:sqlite`
  (`engines: ^22.19.0 || >=24.0.0`), so import it from host code only.
- `./client` subpath: the shared settings-card scaffolding for browser
  bundles — canonical `dsh-plugin-card` shell CSS (`PLUGIN_CARD_SHELL_CSS`),
  `ChevronDown`, `CardShell`, `registerSettingsCard` /
  `registerSettingsSlot` / `injectCardStyles`,
  `bindSettingsExternalStore`, and `startVisibilityAwarePolling`. It also ships
  the credential-help note itself: `CredentialHelpNote` renders the trigger and
  its disclosure panel (`credentialHelpView` turns metadata into the view, and
  `CREDENTIAL_HELP_CSS` carries its rules). The note renders inside any settings
  card — `settings.plugin.item`, a feature-owned tab, the Models page's
  provider cards — and renders nothing at all when there is no metadata.

## Workspace usage

```json
"@yadsh/dsh-plugin-kit": "workspace:^"
```

Runtime imports must be declared in `dependencies`, not `devDependencies`: a
published plugin resolves them from `node_modules` at install time. Client-only
and test-only imports may stay in `devDependencies`, because the client bundle
inlines them.

## Development

```bash
pnpm build
pnpm test
pnpm typecheck
```

## License

MIT
