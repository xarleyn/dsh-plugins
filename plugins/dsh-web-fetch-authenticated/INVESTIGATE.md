# INVESTIGATE.md — DSH API assumptions for `dsh-web-fetch-authenticated`

Phase 0 artifact (SPEC §29). Verified against the DSH source tree at
`D:/repos/dsh/deepseek-harness-source` (DSH `0.1.1-rc.2`, the version the
monorepo catalog pins for `dsh-dev` and the floor for `dsh`), and against the
published npm packages `@deepseek-ai/dsh-web@0.1.1-rc.2`,
`@deepseek-ai/dsh-credentials@0.1.1-rc.2`, `@deepseek-ai/dsh-timeout` (same
line). Repo conventions verified against `plugins/dsh-prompt-firewall` and
`plugins/dsh-qa-surface` plus `packages/plugin-kit`.

## 1. Web seam (`@deepseek-ai/dsh-web`)

- `ctx.web` is `WebRuntime extends Service` (`packages/web/web/src/index.ts`).
  Registration: `ctx.web.registerFetchProvider(provider)` returns a disposer;
  duplicate ids throw `WebError('WEB_DUPLICATE_PROVIDER')`.
- Selection: `WebRuntimeConfig.fetchProvider` (or `$DSH_WEB_FETCH_PROVIDER`
  env) pins the provider id; unset → auto-select with exactly one usable
  provider, else `WEB_PROVIDER_AMBIGUOUS`.
- `WebFetchProvider` = `{ id: string; available(): boolean; fetch(request, signal?): Promise<WebFetchResult> }`.
- `WebFetchRequest` = `{ url: string }` — nothing else reaches the provider,
  so the model cannot influence headers, methods, or credentials.
- `WebFetchResult` = `{ url: finalUrl; statusCode: number; body: {kind:'html'|'text'; content: string}; truncated: boolean }`.
  A non-2xx response is a RESULT, not an error.
- `WebError extends HarnessError` with an open-string `code` and `{cause}`:
  `new WebError(message, code, { cause })`. Provider-specific codes are
  explicitly allowed (“Consumers must tolerate provider-specific codes”), so
  the plugin uses `AUTH_FETCH_*` codes directly; tool-web surfaces the code in
  structured error metadata.

## 2. Upstream anonymous provider (`@deepseek-ai/dsh-web-fetch-http`)

- Registers provider id `'http'`; enforces same-origin redirects, URL hygiene
  (`validateFetchUrl`: http(s) only, no embedded credentials, length cap),
  byte/char caps, charset handling, content-type classification.
- Explicitly does NOT implement SSRF/private-network protection (its own
  header doc says so) — exactly the gap this plugin fills.
- Reuse strategy (SPEC §14): upstream exports NO public policy API in the
  published tarball (`files` = `lib/index.js`, `lib/invariant.js`; the
  `./src/*` subpath exists in the repo manifest but is NOT packed). Therefore
  option 3 applies: small, clearly attributed copies of the pure policy
  helpers (`validateFetchUrl`, `isSameOrigin`, `classifyContentType`,
  `parseCharset`, `decoderForCharset`) live in `src/policy/url.ts` and
  `src/transport/charset.ts`. Transport is NOT copied: see §6.

## 3. Credentials seam (`@deepseek-ai/dsh-credentials`)

- `ctx.credentials` is `CredentialProvider` with:
  - `resolve(ref): Promise<ResolvedCredential | undefined>` — per-call, never
    cached (the plugin resolves once per fetch, satisfying “re-resolve each
    operation”);
  - `describe(ref): Promise<CredentialInfo>` — `{configured, source?, writable}`,
    never the value;
  - `set(ref, value)` / `unset(ref)` — writable-layer writes; `set` rejects
    empty values and read-only-shadowed refs.
- `CredentialRef` is a POSIX env-var-style name (`/^[A-Za-z_][A-Za-z0-9_]*$/`,
  helpers `credentialRef()` / `isCredentialRefName()`). Rule configs store the
  ref NAME only.
- Browser clients do NOT touch `ctx.credentials` directly. The first-party
  client path is the apiproxy credentials domain
  (`packages/host/apiproxy/src/api/credentials.ts`):
  `api.credentials.describe({refs}) → {credentials: Record<ref, {configured, source?, writable}>}`,
  `api.credentials.set({ref, value})`, `api.credentials.unset({ref})` —
  write-only; values never ride responses. Verified used verbatim by
  `ui-settings-plugins/src/client/web-search-card-controller.ts` (the
  first-party Web Search card). This plugin's client card follows the same
  pattern.

## 4. Settings + plugin configuration

- `installSettingsSection(ctx, ns, schema, entry, hooks)` from
  `@deepseek-ai/dsh-settings` registers the plugin's schemastery Config as a
  settings section (base = composition entry) and pushes the resolved scope to
  `hooks.setSource`; `hooks.onChange` fires after every committed change. This
  is how UI edits reach the running provider without a restart.
- Client side: `ctx.settingsScope.bind<T>({namespace})` (provided by
  `@deepseek-ai/dsh-client-ui-settings`) → `{getSnapshot, subscribe, set(field, value), unset(field)}`;
  snapshot carries `{status, value, revision, writable}`. Writes go through
  `api.settings.mutate` with the namespace revision and are schema-validated
  on the Host (schemastery resolves the section). Writes from non-loopback
  browsers stay process-local (`connection.isLoopback` gate inside the binder).
- A host-side `SettingsSectionHooks.validate` hook is the backstop for
  cross-field constraints the schema cannot express; the client performs the
  same checks first (shared pure validators) so rejections are explained in
  the form, not silently swallowed by the scope's recovery path.

## 5. Plugin UI extension points

- Cards register into the keyed slot `settings.plugin.item`
  (`@deepseek-ai/dsh-client-ui-slots`), key = settings namespace. The repo's
  shared kit `@yadsh/dsh-plugin-kit/client` provides `CardShell` (AGENTS.md
  shell contract), `registerSettingsCard`, `bindSettingsExternalStore`,
  `startVisibilityAwarePolling`, and `PLUGIN_CARD_SHELL_CSS`.
- The browser bundle is built by tsdown as CJS with the banner
  `window.__ModuleLoader__.load({ id: "<full package name>", factory: ... })`
  (AGENTS.md identity rule; asserted by `scripts/verify-package.mjs` and the
  shared `verifyPluginCardContract`).
- Client `inject` names verified: `slots`, `settingsScope` (ui-settings),
  `connection` (`ctx.provide('connection', handle)` in dsh-client-connection —
  `connection.api` is the `IApiClient` carrying the credentials domain),
  `remote` (typert gateway, `ctx.remote.$mount(contribution)`).

## 6. Host↔client RPC

- Pattern: `TypertRemoteService` from `@deepseek-ai/dsh-typert-protocol`;
  methods annotated `@Remote('name')`; artifacts generated by
  `@deepseek-ai/dsh-typert-generator` through the shared wrapper
  `@yadsh/dsh-plugin-scripts/generate-typert` (stages `src` minus `src/client/**`,
  emits `lib/typert.host.js` + `lib/typert.remote-client.js`). Used by
  prompt-firewall / plugin-log-ui / qa-surface / session-scope.
- This plugin's remote face: `status()`, `testRule(ruleId, url?)`,
  `diagnose(url)` — all return sanitized projections; the test fetch runs in
  the Host so credential values never leave it.

## 7. Transport decision (deviation from upstream)

- Upstream uses global `fetch(redirect: 'manual')`. Global fetch cannot pin
  DNS: SSRF-safe fetching needs the connection to use EXACTLY the addresses
  the policy approved. Without an extra `undici` dependency (its dispatcher
  supports a custom `connect.lookup` but the package is not part of the DSH
  dependency graph), the plugin implements its transport on `node:http` /
  `node:https` with a custom `lookup` option:
  - resolve via `dns.lookup(hostname, {all: true, verbatim: true})`;
  - classify EVERY resolved address (fail closed on mixed answers — DNS
    rebinding / lookalike defense, SPEC §10.2);
  - hand only approved addresses to the socket, so no re-resolution can
    bypass the check between approval and connect;
  - redirects are followed manually, one hop at a time, re-running URL
    validation, rule re-match, and (through the new request) DNS/network
    checks per hop.
- Deadline/cancellation: the pipeline fuses the caller's `AbortSignal` with
  `AbortSignal.timeout(rule.limits.timeoutMs)` (`AbortSignal.any`); a
  `TimeoutError` abort reason maps to `AUTH_FETCH_TIMEOUT`, any other abort to
  `WEB_ABORTED`. (`@deepseek-ai/dsh-timeout`'s `deadline()` would work too, but
  it leans on `Symbol.dispose` typing the shared monorepo and Typert-staging
  tsconfigs do not enable; the plain signals keep the plugin dependency-free.)

## 8. Non-public integration points (isolated in `src/dsh-compat/`)

1. “Is `ctx.web.fetchProvider` pinned to `authenticated`?” — `WebRuntime`
   keeps `fetchProviderId` private and exposes no accessor. The status card
   does a best-effort structural read
   (`(ctx.web as {fetchProviderId?: string}).fetchProviderId`) and reports
   “not pinned” when absent. Diagnostic only; behavior never depends on it.
2. Nothing else. Registration, credentials, settings, UI slots, and RPC are
   all public seams per §1–§6.

## 9. Repo gates this package must satisfy

- `scripts/verify-package-hygiene.mjs`: files list must include
  compatibility.json, cordis.patch.yml, LICENSE, README.md; `./package.json`
  export; `lib/types/index.d.ts` types layout; compatibility.json declares
  `deepseekHarness.range` + testedReleases + node matching engines.
- `scripts/verify-plugin-logging.mjs`: dependency `@yadsh/dsh-plugin-log:
  workspace:^`; at least one host source imports it; `src/client/**` must not.
- `scripts/verify-plugin-card-contract.mjs`: canonical shell CSS + chevron
  SVG path in the built client bundle; no font glyphs; no non-canonical shell
  tokens.
- `scripts/tarball-verify.sh`: packed exports must exist; no workspace:/catalog:
  leak (pnpm pack rewrites); smoke-import under plain Node.

## 10. Version/identity decisions

- Package: `@yadsh/dsh-web-fetch-authenticated` (repo scope), cordis plugin
  id `web-fetch-authenticated`, provider id `authenticated` (SPEC §4/§33).
- `@deepseek-ai/dsh-web`, `@deepseek-ai/dsh-credentials` added to the
  workspace catalogs (`dsh` range `>=0.1.1-rc.2 <0.2.0`, `dsh-dev` pin
  `0.1.1-rc.2`) — same pattern as the other DSH packages.
- Peer deps: cordis, schemastery, dsh-web, dsh-credentials, dsh-settings,
  dsh-typert-protocol, dsh-client-runtime, dsh-client-connection,
  dsh-client-ui-settings, dsh-client-ui-settings-plugins, dsh-client-ui-slots,
  react. `@yadsh/dsh-plugin-kit` stays dev-only (bundled into the client at
  build time).
