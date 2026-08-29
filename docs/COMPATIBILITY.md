# Compatibility policy

The monorepo keeps tested DeepSeek Harness ranges in pnpm named catalogs. The
current baseline is Cordis 4.0.1 and the DSH `0.1.1-rc.2` package family.

## Catalogs

`pnpm-workspace.yaml` defines two DSH catalogs:

- `catalog:dsh` contains the compatible peer ranges shipped in public package
  manifests (`^4.0.1` for Cordis and `>=0.1.1-rc.2 <0.2.0` for DSH packages).
- `catalog:dsh-dev` contains exact versions used by local builds and CI.

Every imported DSH runtime is a `peerDependency`; the matching development copy
is a `devDependency`. Runtime packages must not be placed in ordinary
`dependencies`, because the host must provide a single compatible framework
instance.

## Package matrix

| Package | DSH peers |
| --- | --- |
| `@yadsh/dsh-doc-impact` | Cordis, LLM, tools |
| `@yadsh/dsh-draft-sessions` | Cordis, gateway, client runtime/connection/locale/UI, Typert protocol |
| `@yadsh/dsh-l10n-overrides` | Cordis, client locale |
| `@yadsh/dsh-prompt-firewall` | Cordis, gateway, client settings/runtime/slots, settings, system prompt, Typert protocol |
| `@yadsh/dsh-session-scope` | filesystem, sandbox, session |
| `@yadsh/dsh-sleev` | Cordis, client locale/runtime/settings/slots, LLM, settings |
| `@yadsh/dsh-plugin-kit` | Cordis |
| `@yadsh/dsh-test-kit` | Cordis, Vitest |

`@yadsh/dsh-config` is private build configuration and is never installed into
a DSH profile. `plugins/dsh-ui-repair` is currently a specification, not a
package.

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
