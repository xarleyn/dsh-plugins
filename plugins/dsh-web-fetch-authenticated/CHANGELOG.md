## 0.3.1 (2026-09-13)

### 🩹 Fixes

- Fix the settings card never mounting in the web UI. The 0.1.5 client runtime ([ed36855](https://github.com/xarleyn/dsh-plugins/commit/ed36855))
  exposes `remote.credentials` as its own Cordis service key (owned by
  `dsh-api-settings-controller`), separate from `remote`, and reading a service
  that is not declared in `inject` throws `cannot get property
  "remote.credentials" without inject`. The client half read the namespace
  without declaring it, so the whole browser-side plugin failed to apply — the
  Plugins page rendered no Authenticated Web Fetch card, and the loader error
  took the entire plugin list down with it. The client now declares
  `remote.credentials` beside `remote` and `settingsScope`, matching the
  first-party settings plugins, and the package contract asserts the
  declaration in the built bundle so the omission cannot come back.

  The release also removes an internal project key from every example in the
  package: the Diagnostics and rule-tester placeholders in the shipped client
  bundle, the Jira adapter's key-format comment, the SPEC and the test fixtures
  now use the neutral `PROJ-123` shape.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.3.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.3.0 (2026-09-12)

### 🚀 Features

- Migrate to the DSH 0.1.5-rc.2 client surface: credentials move from the ([458b9c2](https://github.com/xarleyn/dsh-plugins/commit/458b9c2))
  removed IApiClient carrier to the `remote.credentials` Typert remote
  (describe/set/unset RemoteResults), the settings section installs via
  SettingsProvider.installSection, and the supported host range moves to
  `>=0.1.5-rc.2 <0.2.0`, dropping 0.1.1-rc.2.

  Content adapters (SPEC §29 phase 4): a rule can select a `jira` or
  `confluence` content adapter. Recognized URLs (`/browse/ISSUE-KEY`,
  `/issues/KEY`, `/pages/<id>`, `/display/SPACE/Title`) are re-fetched from the
  product REST API through the same authenticated transport and normalized into
  compact Markdown — issue fields plus optional comments/links (Server wiki
  markup and Cloud ADF both convert), page metadata plus a storage-format XHTML
  to Markdown conversion with code/panel/expand macros handled. Unrecognized
  URLs fall back to raw HTTP/HTML; the connection tester runs the adapter too;
  malformed REST bodies fail with the new `AUTH_FETCH_ADAPTER_FAILED` code.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.0 (2026-09-10)

### 🚀 Features

- Initial release: authenticated `WebFetchProvider` for `ctx.web` with per-origin ([58320f3](https://github.com/xarleyn/dsh-plugins/commit/58320f3))
  rules, Bearer/Basic/API-key-header auth backed by DSH credential references,
  SSRF network policy with DNS pinning, same-origin redirect enforcement, response
  limits, centralized secret redaction, and a settings card with a rule editor,
  write-only credential fields, a connection tester, and sanitized diagnostics.

### ❤️ Thank You

- xarleyn @xarleyn

# Changelog

## 0.1.0 (2026-09-09)

### 🚀 Features

- Initial release: authenticated `WebFetchProvider` for `ctx.web` with
  per-origin rules, Bearer/Basic/API-key-header auth backed by DSH credential
  references, SSRF network policy with DNS pinning, same-origin redirects,
  response limits, centralized redaction, and a settings-UI card with rule
  editor, write-only credential fields, connection tester, and diagnostics.
