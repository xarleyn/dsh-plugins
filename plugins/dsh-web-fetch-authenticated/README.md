# @yadsh/dsh-web-fetch-authenticated

[Русский гайд: настройка Jira и Confluence](docs/JIRA-CONFLUENCE.ru.md)

An authenticated, policy-gated [`WebFetchProvider`](../../docs/) for the
DeepSeek Harness web capability seam (`ctx.web`). It lets the existing
model-facing `web_fetch(url)` tool retrieve content from approved
authenticated resources — corporate Jira, Confluence, GitLab, internal wikis —
**without exposing credentials to the model, the tool arguments, session logs,
prompts, or the browser UI**.

> The model chooses a URL. The plugin decides whether that URL is allowed,
> which credential may be used for it, how authentication is attached, and
> whether redirects are safe. The model never supplies or receives secrets.

## How it works

```text
web_fetch(url)
  -> ctx.web (fetchProvider: authenticated)
  -> normalize URL
  -> rule match (exact hosts, glob paths)
  -> network policy (SSRF: DNS resolution + per-address classification)
  -> credential lookup (ctx.credentials, per request)
  -> auth injection (Bearer / Basic / API-key header)
  -> request with DNS pinning
  -> per-hop redirect re-validation
  -> bounded body read
  -> content adapter (optional: REST fetch + normalization, see below)
  -> WebFetchResult (existing dsh-tool-web HTML -> Markdown)
```

- One fetch provider (`id: authenticated`) routes internally across all rules —
  `web_fetch` and the model stay unchanged (SPEC §16).
- Requests without a matching rule **fail closed** (`AUTH_FETCH_NO_MATCHING_RULE`).
- Authentication is attached only after URL validation, rule matching, and
  network-policy approval; redirect targets are re-matched and re-checked, and
  a credential never crosses into an origin its own rule does not authorize.
- Logs, audit records, error messages, and UI previews are scrubbed by the
  centralized redaction utilities.

## Configuration

Everything is editable from the DSH Web UI (Settings → Plugins →
Authenticated Web Fetch): rules, credential write-only fields, network
policy, redirects, limits, connection tester, and diagnostics. Declarative
config stays available:

```yaml
- id: web
  config:
    fetchProvider: authenticated

- id: web-fetch-authenticated
  name: '@yadsh/dsh-web-fetch-authenticated'
  config:
    rules:
      - id: corp-jira
        name: Corporate Jira
        enabled: true
        testUrl: https://jira.example.corp/status
        match:
          hosts: [jira.example.corp]
          allowPaths: [/browse/**, /rest/api/**]
        auth:
          type: bearer
          credential: JIRA_TOKEN        # credential REFERENCE, not the secret
        networkPolicy:
          allowPrivate: true
          allowedCidrs: [10.40.0.0/16]
        redirects:
          mode: same-origin
          maxRedirects: 3

- id: tool-web
  name: '@deepseek-ai/dsh-tool-web'
  config:
    fetch: true
```

Secrets are stored through the DSH credential store (`$DSH_HOME` credential
backend) under POSIX-style reference names (`JIRA_TOKEN`); configuration keeps
only the reference. Use the UI (or `api.credentials.set`) to store the value.

For an end-to-end corporate setup, including provider selection, credentials,
private-network policy, Jira/Confluence Cloud and Server/Data Center examples,
testing, and troubleshooting, see the
[Russian Jira and Confluence guide](docs/JIRA-CONFLUENCE.ru.md).

### Security defaults

| Policy | Default |
|---|---|
| Schemes | HTTPS only (per-rule `http` opt-in warns) |
| Private networks / loopback / link-local / CGNAT / IPv6 ULA | denied |
| Cloud metadata (169.254.169.254, fd00:ec2::254) | always denied |
| Redirects | same-origin only, max 3 |
| Timeout / response size / body chars | 30 s / 5 MiB / 100 k chars |
| Unmatched URLs | blocked (strict) |

Narrow `allowedCidrs` are preferred over blanket `allowPrivate: true`. DNS
answers are resolved, all candidates are classified, one denied answer denies
the whole set (DNS-rebinding defense), and the socket is pinned to the
approved addresses.

## Content adapters (Jira / Confluence)

Raw HTML from enterprise apps converts to Markdown with all the application
chrome attached. A rule can instead select a **content adapter**: recognized
URLs are re-fetched from the product's REST API through the same authenticated
transport (same network policy, credentials, redirect policy, and limits) and
normalized into compact Markdown text — issue fields, description, and optional
comments/links for Jira; page metadata and the storage-format body for
Confluence. Unrecognized URLs fall back to raw HTTP/HTML.

- **Jira** — `/browse/ISSUE-KEY` at any deployment depth and `/issues/KEY`.
  `jiraFlavor: server` (default) uses REST v2 and converts wiki-markup bodies;
  `jiraFlavor: cloud` uses REST v3 and converts Atlassian Document Format.
  `includeComments` and `includeLinks` add comments and issue links (off by
  default).
- **Confluence** — `/pages/<id>/…` (Server and Cloud, including `/wiki/…`
  paths) fetch directly; `/display/<SPACE>/<Title>` resolves via the title
  lookup. Storage-format XHTML becomes Markdown: headings, lists, tables,
  links, entities, code/noformat/panel/expand macros (unknown macros leave a
  visible placeholder instead of vanishing).

Configured in the rule editor ("Content adapter") or declaratively:

```yaml
adapter:
  type: jira
  jiraFlavor: server
  includeComments: true
```

Non-2xx REST responses stay results (the seam never throws for status codes):
the model sees a short `[Jira]`/`[Confluence]` HTTP-status note. Malformed or
non-JSON REST bodies fail with `AUTH_FETCH_ADAPTER_FAILED`. The generated text
is capped by the rule's `maxBodyChars`, and the connection tester runs the
adapter too, so Test shows the exact normalized text the model will get.

## Error codes

`AUTH_FETCH_NO_MATCHING_RULE`, `AUTH_FETCH_AMBIGUOUS_MATCH`,
`AUTH_FETCH_RULE_DISABLED`, `AUTH_FETCH_CREDENTIAL_MISSING`,
`AUTH_FETCH_CREDENTIAL_INVALID`, `AUTH_FETCH_NETWORK_DENIED`,
`AUTH_FETCH_DNS_POLICY_DENIED`, `AUTH_FETCH_REDIRECT_DENIED`,
`AUTH_FETCH_RESPONSE_TOO_LARGE`, `AUTH_FETCH_UNSUPPORTED_CONTENT`,
`AUTH_FETCH_TIMEOUT`, `AUTH_FETCH_INVALID_URL`, `AUTH_FETCH_PROVIDER_ERROR`,
`AUTH_FETCH_ADAPTER_FAILED` —
surfaced as `WebError` codes through the existing `web_fetch` error metadata.

## Development

```sh
pnpm install
pnpm --filter @yadsh/dsh-web-fetch-authenticated build
pnpm --filter @yadsh/dsh-web-fetch-authenticated test
pnpm --filter @yadsh/dsh-web-fetch-authenticated check   # lint + typecheck + test + verify
```

`INVESTIGATE.md` documents the exact DSH APIs and integration assumptions
(SPEC phase 0). Cookies/OAuth and advanced auth remain excluded (SPEC §29
phase 5); the Jira/Confluence content adapters (phase 4) are implemented.

## License

MIT
