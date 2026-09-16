# @yadsh/dsh-plugin-kit

Shared runtime helpers for DeepSeek Harness plugins.

The kit is published to npm so that a plugin's host code can import it at
runtime. Its `./client` half is inlined into each plugin's tsdown client
bundle, which keeps published browser bundles self-contained.

## Features

- Lightweight console logging for tests and local scaffolds. Production
  plugins use `@yadsh/dsh-plugin-log`.
- Major-version compatibility checking (`hasCompatibleMajor`)
- Configuration validation (`validateConfig`)
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
  `bindSettingsExternalStore`, and `startVisibilityAwarePolling`.

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
