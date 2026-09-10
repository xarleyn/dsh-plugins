# Compatibility policy

The monorepo keeps tested DeepSeek Harness ranges in pnpm named catalogs. The
current baseline is Cordis 4.0.2 and the DSH `0.1.5-rc.2` package family.

Every publishable plugin carries `compatibility.json`. Its `node` value must
exactly match `package.json#engines.node`, and the repository package-hygiene
gate enforces that relationship together with the DSH range and tested release
list.

New generated plugins use the canonical Node baseline
`^22.19.0 || >=24.0.0`. Existing published packages keep their currently
declared Node 20/22 ranges until maintainers choose whether to preserve tested
Node 20 support or release a coordinated breaking baseline change. Engines are
therefore not normalized package-by-package without a Node-version test matrix
and release decision.

## Catalogs

`pnpm-workspace.yaml` defines two DSH catalogs:

- `catalog:dsh` contains the compatible peer ranges shipped in public package
  manifests (`^4.0.2` for Cordis and `>=0.1.5-rc.2 <0.2.0` for DSH packages).
- `catalog:dsh-dev` contains exact versions used by local builds and CI.

Every imported DSH runtime is a `peerDependency`; the matching development copy
is a `devDependency`. Runtime packages must not be placed in ordinary
`dependencies`, because the host must provide a single compatible framework
instance.

## Package matrix

| Package | DSH peers |
| --- | --- |
| `@yadsh/dsh-cas-results` | Cordis, schemastery, tools |
| `@yadsh/dsh-doc-impact` | Cordis, LLM, tools |
| `@yadsh/dsh-draft-sessions` | Cordis, gateway, api-session-controller, api-workspace-controller, session, client connection/locale/renderer/UI, Typert protocol |
| `@yadsh/dsh-kv-persist` | Cordis, schemastery, LLM |
| `@yadsh/dsh-l10n-overrides` | Cordis, client locale |
| `@yadsh/dsh-model-safety-gate` | Cordis, schemastery, agent, LLM, session, tools |
| `@yadsh/dsh-plugin-log-ui` | Cordis, schemastery, gateway, client connection/renderer/settings/settings-plugins/slots, settings, Typert protocol, React |
| `@yadsh/dsh-prompt-firewall` | Cordis, gateway, client renderer/settings/slots, settings, system prompt, Typert protocol |
| `@yadsh/dsh-qa-surface` | Cordis, schemastery, gateway, agent, agent presets, api-session-controller, api-workspace-controller, permissions, session, settings, tools, workspace, webserver, client connection/conversation/chat/renderer/layout/settings/slots/theme, Typert protocol, React |
| `@yadsh/dsh-session-scope` | filesystem, sandbox, session |
| `@yadsh/dsh-sleev` | Cordis, client locale/renderer/store/settings/slots, LLM, settings |
| `@yadsh/dsh-tool-offload` | Cordis, schemastery, tools, subagent |
| `@yadsh/dsh-ui-repair` | Cordis, schemastery, client renderer/settings/settings-plugins/slots, settings |
| `@yadsh/dsh-user-correction-miner` | Cordis, schemastery, LLM, session, session-query, storage-domain |
| `@yadsh/dsh-web-fetch-authenticated` | Cordis, schemastery, credentials, web, settings, client connection/renderer/settings/slots, Typert protocol, React |
| `@yadsh/dsh-plugin-log` | none |
| `@yadsh/dsh-plugin-kit` (private) | Cordis |
| `@yadsh/dsh-test-kit` (private) | Cordis, Vitest |
| `@yadsh/dsh-config` (private) | none |

`@yadsh/dsh-config`, `@yadsh/dsh-plugin-kit`, and `@yadsh/dsh-test-kit` are
private workspace packages and are not published.

## DSH 0.1.5 migration notes

The `0.1.5-rc.2` host dissolved `@deepseek-ai/dsh-client-runtime`: session
state moved to `@deepseek-ai/dsh-api-session-controller`, workspace state to
`@deepseek-ai/dsh-api-workspace-controller`, snapshot stores to
`@deepseek-ai/dsh-client-store`, and the chat transcript to the
`@deepseek-ai/dsh-client-ui-chat` `chat` view snapshot. `IApiClient`,
`RpcError`, and `HostDescriptionSource` are gone — clients use the
`ctx.remote: ClientRemote` Typert face and `RemoteError`/`RemoteFailure`.
Server-side, `dsh-settings` replaced the `installSettingsSection` helper with
`SettingsProvider.installSection`, the session log became format v3
(`session.snapshotEvents()`/`session.surface` instead of `session.events`),
and `dsh-tools` renamed the `code` presentation family to `ptc`. The plugins
no longer run on `0.1.1-rc.2` hosts.

## Upgrade rules

1. Update peer ranges in `catalog:dsh` and exact CI versions in
   `catalog:dsh-dev` together.
2. Run `pnpm install` to refresh the single root lockfile.
3. Run `pnpm check`, `pnpm deps:check`, and `pnpm tarball:verify`.
4. Update this matrix and affected plugin READMEs if the supported surface
   changes.
5. Treat a dropped compatible runtime range as a breaking package change.

If a future DSH line needs incompatible code, use feature detection or a new
major package release. Do not widen peer ranges without executing the full
compatibility and packed-install tests.
