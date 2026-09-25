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

`catalog:runtime` is not a DSH catalog: it holds a third-party runtime range that
more than one plugin ships as ordinary `dependencies` because the host provides
no equivalent (currently `zod`), so one edit moves every consumer. Packing
rewrites the catalog back to its range, so the published manifest stays byte
identical. A library only one package needs keeps a literal range in that
manifest — there is nothing to share — and `pnpm deps:check` lists those literals
instead of forbidding them (SPEC §27.12).

Every imported DSH runtime is a `peerDependency`; the matching development copy
is a `devDependency`. Runtime packages must not be placed in ordinary
`dependencies`, because the host must provide a single compatible framework
instance.

## Package matrix

| Package | DSH peers |
| --- | --- |
| `@yadsh/dsh-answer-review-gate` | Cordis, schemastery, LLM |
| `@yadsh/dsh-cas-results` | Cordis, schemastery, tools |
| `@yadsh/dsh-doc-impact` | Cordis, LLM, tools |
| `@yadsh/dsh-documents` | Cordis, schemastery, tools, settings, client settings/settings-plugins/slots, React |
| `@yadsh/dsh-domain-experts` | Cordis, schemastery, agent, session, settings, storage-domain, subagent, tools, gateway, client renderer/settings, Typert protocol, React |
| `@yadsh/dsh-draft-sessions` | Cordis, gateway, api-session-controller, api-workspace-controller, session, client connection/locale/renderer/UI, Typert protocol |
| `@yadsh/dsh-git-readonly` | tools, schemastery |
| `@yadsh/dsh-kv-persist` | Cordis, schemastery, LLM |
| `@yadsh/dsh-l10n-overrides` | Cordis, client locale |
| `@yadsh/dsh-jev-compaction` | Cordis, schemastery, LLM, session |
| `@yadsh/dsh-lightrag` | tools, schemastery |
| `@yadsh/dsh-model-safety-gate` | Cordis, schemastery, agent, LLM, session, tools |
| `@yadsh/dsh-openviking-memory` | Cordis, schemastery, agent, LLM, session, tools, settings, MCP client, skill filesystem, gateway, Typert protocol, React |
| `@yadsh/dsh-plugin-log-ui` | Cordis, schemastery, gateway, client connection/renderer/settings/settings-plugins/slots, settings, Typert protocol, React |
| `@yadsh/dsh-preset-persona-editor` | Cordis, schemastery, agent presets, system prompt, gateway, client renderer/settings/slots, Typert protocol, React |
| `@yadsh/dsh-prompt-firewall` | Cordis, gateway, client renderer/settings/slots, settings, system prompt, Typert protocol |
| `@yadsh/dsh-qa-browser` | Cordis, schemastery, agent, attachment, gateway, api-session-controller, webserver, tools, client renderer/slots, Typert protocol, React, React DOM |
| `@yadsh/dsh-qa-integrations` | Cordis, schemastery, tools, settings, client settings/settings-plugins, Typert protocol, React |
| `@yadsh/dsh-qa-surface` | Cordis, schemastery, gateway, agent, agent presets, api-session-controller, api-workspace-controller, permissions, session, settings, tools, workspace, webserver, client connection/conversation/chat/renderer/layout/settings/slots/theme, Typert protocol, React |
| `@yadsh/dsh-session-audit` | Cordis, schemastery, home paths, gateway, client conversation/renderer/slots, Typert protocol, React |
| `@yadsh/dsh-session-scope` | filesystem, sandbox, session |
| `@yadsh/dsh-sleev` | Cordis, client locale/renderer/store/settings/slots, LLM, settings |
| `@yadsh/dsh-tool-offload` | Cordis, schemastery, tools, subagent |
| `@yadsh/dsh-ui-repair` | Cordis, schemastery, client renderer/settings/settings-plugins/slots, settings |
| `@yadsh/dsh-user-correction-miner` | Cordis, schemastery, LLM, session, session-query, storage-domain |
| `@yadsh/dsh-web-fetch-authenticated` | Cordis, schemastery, credentials, web, settings, client connection/renderer/settings/slots, Typert protocol, React |
| `@yadsh/dsh-audit-core` | none |
| `@yadsh/dsh-audit-ui` | React |
| `@yadsh/dsh-plugin-log` | none |
| `@yadsh/dsh-plugin-kit` | Cordis |
| `@yadsh/dsh-plugin-scripts` (private) | none |
| `@yadsh/dsh-test-kit` (private) | Cordis, Vitest |
| `@yadsh/dsh-config` (private) | none |

`@yadsh/dsh-config`, `@yadsh/dsh-plugin-scripts`, and `@yadsh/dsh-test-kit` are
private workspace packages and are not published. The publishable set is exactly
the `release.projects` list in `nx.json`: `plugins/*` plus `plugin-log`,
`plugin-kit`, `audit-core` and `audit-ui`.

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
no longer run on `0.1.1-rc.2` hosts. Note that the `SettingsProvider.installSection`
contract recorded above is itself removed in `0.1.7-rc.1`, see below.

## DSH 0.1.7-rc migration

`0.1.7-rc.1` and `0.1.7-rc.2` were both investigated; **neither is adopted** — the
repository stays on `0.1.5-rc.2`. The `dsh-settings` rewrite removes
`SettingsProvider`, `installSection`, `ctx.settingsScope` and the
`settings.plugin.item` slot, which is the surface 12 plugins register
configuration UI on, so the cutover is a redesign rather than a version bump.
`0.1.7-rc.2` does not change that verdict: the settings subsystem, the slot
registry, the module-loader bundle format, the agent/session event catalog and
the framework tier are all byte-identical between the two release candidates. A
trial bump measured 296 type errors across the same 18 packages at `rc.2`
(288 at `rc.1`), against a green baseline control in the same worktree.

`rc.2` adds three things the `rc.1` map did not foresee: the host now *emits*
`tool-addition`/`tool-removal` content blocks (type-clean, runtime-visible), the
Auto permission preset resolves to `approval: 'ask'` where `dsh-qa-surface`
attests a pinned `'never'`, and durable preset authoring turned out to be deleted
rather than relocated. See
[DSH-0.1.7-MIGRATION.md](DSH-0.1.7-MIGRATION.md) — sections 8–13 — for the
`rc.1 → rc.2` delta, the measured failures, the open owner decisions and the
per-package work breakdown.

## Upgrade rules

1. Update peer ranges in `catalog:dsh` and exact CI versions in
   `catalog:dsh-dev` together.
2. Run `pnpm install` to refresh the single root lockfile.
3. Run `pnpm check` (its chain ends with `deps:check`) and
   `pnpm tarball:verify`.
4. Update this matrix and affected plugin READMEs if the supported surface
   changes.
5. Treat a dropped compatible runtime range as a breaking package change.

If a future DSH line needs incompatible code, use feature detection or a new
major package release. Do not widen peer ranges without executing the full
compatibility and packed-install tests.
