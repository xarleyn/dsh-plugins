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
