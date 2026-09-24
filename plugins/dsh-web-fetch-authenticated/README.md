# @yadsh/dsh-web-fetch-authenticated

[Русский гайд: настройка Jira и Confluence](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-web-fetch-authenticated/docs/JIRA-CONFLUENCE.ru.md)

An authenticated, policy-gated [`WebFetchProvider`](../../docs/) for the
DeepSeek Harness web capability seam (`ctx.web`). It lets the existing
model-facing `web_fetch(url)` tool retrieve content from approved
authenticated resources — corporate Jira, Confluence, GitLab, internal wikis —
**without exposing credentials to the model, the tool arguments, session logs,
prompts, or the browser UI**.

> The model chooses a URL. The plugin decides whether that URL is allowed,
> which credential may be used for it, how authentication is attached, and
> whether redirects are safe. The model never supplies or receives secrets.

## Installation

Install the published npm package by name:

```bash
dsh plugin --profile web add @yadsh/dsh-web-fetch-authenticated
```

To remove the plugin:

```bash
dsh plugin --profile web remove @yadsh/dsh-web-fetch-authenticated
```

Then pin the provider in the profile patch (`fetchProvider: authenticated`) so
the model-facing `web_fetch` tool routes through this plugin; without the pin
the plugin stays inert.

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
[Russian Jira and Confluence guide](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-web-fetch-authenticated/docs/JIRA-CONFLUENCE.ru.md).

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
  paths), the page links Confluence itself hands out
  (`/pages/viewpage.action?pageId=<id>`, plus the legacy
  `?spaceKey=<KEY>&title=<Title>` form), and `/display/<SPACE>/<Title>`
  (resolved through the title lookup). Storage-format XHTML becomes Markdown:
  headings, paragraphs, lists (task lists become `- [x]` checkboxes), tables,
  code/noformat fences, panel/info/note/warning/tip callouts, status badges,
  links and entities. Layout macros (`section`, `column`, `div`) are unwrapped
  so the content they wrap keeps its block structure.

### Confluence cleanup levels

A Confluence storage body carries page chrome beside the prose. `adapter.cleanup`
decides how much of it reaches the model; the readable content is rendered
identically at every level.

| Level | Navigation macros¹ | Unknown macros | Attachments/images | Emoticons | Inline links, page links, callouts, tasks |
| --- | --- | --- | --- | --- | --- |
| `off` | `_[macro: toc — 2]_` | name + parameters | link to the file (marker only when the URL is unknown) | name | kept |
| `balanced` (default) | dropped | `_[macro: name]_` | link to the file (marker only when the URL is unknown) | name | kept |
| `strict` | dropped | body only, no marker | dropped | dropped | kept |

¹ A table of contents, child-page list, attachment list, search widget, and the
like: macros that aggregate or navigate instead of carrying content. Cross-page
includes still leave `_[includes: Page]_` at `off`/`balanced`, because that
reference is the only trace of the missing text.

Configured in the rule editor ("Content adapter" → "Page cleanup") or
declaratively:

```yaml
adapter:
  type: jira
  jiraFlavor: server
  includeComments: true
```

```yaml
adapter:
  type: confluence
  cleanup: strict
  maxAttachments: 50
```

Non-2xx REST responses stay results (the seam never throws for status codes):
the model sees a short `[Jira]`/`[Confluence]` HTTP-status note. Malformed or
non-JSON REST bodies fail with `AUTH_FETCH_ADAPTER_FAILED`. The generated text
is capped by the rule's `maxBodyChars`, and the connection tester runs the
adapter too, so Test shows the exact normalized text the model will get.

## Confluence attachments and document text

A storage body names an attachment and nothing else — `<ri:attachment
ri:filename="Регламент.docx"/>` — so a page that says "see the attached
regulation" used to reach the model as a bare filename it could do nothing with.
The adapter now resolves every attachment reference (linked file, embedded
image, embedded Office/PDF viewer macro) into its download URL and appends the
page's attachment list:

```markdown
## Attachments

- [Регламент v3.docx](https://wiki.example.corp/wiki/download/attachments/483043310/Регламент%20v3.docx?api=v2) — 46.0 KiB, application/vnd.openxmlformats-officedocument.wordprocessingml.document
```

The list is the page's own attachment collection, so a document the prose
mentions without linking it is still reachable. `adapter.maxAttachments`
(default 50, `0` disables the list) caps how many entries one page reports; the
remainder is stated as a count, never dropped silently. A failed collection
request never costs the page — the prose is served with an
`_[attachment list unavailable]_` marker. `cleanup: strict` serves neither links
nor the list.

The normal `web_fetch` result is text-only: the `WebFetchBody` union is
`html | text` and owned by `@deepseek-ai/dsh-web`. This plugin therefore
extracts supported document text inside the provider and returns it as `text`:

- **Supported**: Word `.docx`/`.docm`/`.dotx` and OpenDocument `.odt` — the
  document is inflated in memory (no external binary, no temporary file) and
  rendered as Markdown: headings, paragraphs, list items, tables, tabs. Field
  codes, deleted revisions, comments, drawings, and footnotes are left out.
- **Refused with a reason**: `.pdf`, `.doc`, `.xlsx`, `.pptx`, archives — the
  model gets `AUTH_FETCH_DOCUMENT_UNREADABLE` naming the format instead of a
  bare "unsupported content type".
- **Not a document**: everything else keeps the plain
  `AUTH_FETCH_UNSUPPORTED_CONTENT` behavior.

### Files: `web_fetch_file`

For a PDF, spreadsheet, presentation, archive, log, unsupported Office file,
or an ordinary HTML/JSON/XML response whose exact bytes are needed, the plugin
registers `web_fetch_file(url)` while durable attachment storage is available.
It runs the same authenticated rule, SSRF, DNS pinning, redirect, timeout and
response-size pipeline as `web_fetch`, then saves the successful response as an
immutable file attachment. Non-2xx responses and bodies above the matched
rule's byte cap are refused and are never stored.

The settings card lists these content families so operators can see which of
the three tools to grant. Registration does not grant access by itself:
administrators still decide which roles or grantable skills receive
`web_fetch_file`, just as they do for `web_fetch_image`.

### Images: `web_fetch_image`

An image is the one download the text seam cannot carry at all, so the plugin
registers a second model-facing tool beside `web_fetch` (SPEC §15.4):

```text
web_fetch_image(url)
  -> the same rule match, network policy and credentials as web_fetch
  -> bounded byte read (deployment image limits)
  -> format verified from the file signature, not the server header
  -> ctx.attachments.saveImage (durable raster attachment)
  -> tool result: text summary + the image block the model can look at
```

- Use it for image attachments, screenshots and charts whose URL `web_fetch`
  refuses as binary content. `web_fetch` itself stays text-only: the harness
  body union (`html | text`) belongs to `@deepseek-ai/dsh-web` and has no
  binary arm a provider could fill.
- Stored formats are the attachment store's raster set: PNG, JPEG, WebP, GIF.
  A response that is not one of them — an HTML error page, a PDF, a 404 —
  fails with `AUTH_FETCH_NOT_AN_IMAGE` naming what arrived instead, and one
  above the byte budget fails with `AUTH_FETCH_IMAGE_TOO_LARGE`.
- The tool registers only while a durable attachment store is mounted: without
  one there is nowhere to keep the image and nothing that could render it
  back to the model. A route whose model declares no image input is refused
  before any download starts.

Caps are per rule and exist because the model's context is finite:

```yaml
- id: corp-confluence
  config:
    documents:
      enabled: true       # default: true
      maxBytes: 4194304   # largest attachment downloaded for extraction (4 MiB)
      maxChars: 40000     # largest extracted text handed to the model
```

`documents` also exists at the top level as the default every rule inherits;
a rule's own block overrides it field by field. Exceeding `maxBytes` is
`AUTH_FETCH_DOCUMENT_TOO_LARGE`; text longer than `maxChars` is cut with an
explicit `_[text truncated at N characters …]_` line and `truncated: true` in
the result. Both appear in the connection tester as well, so Test on an
attachment URL shows exactly the extracted text the model would receive.

Two rules are needed when Jira and Confluence share a hostname (`jira.example.corp`
serving both `/browse/**` and `/wiki/**`): one rule per product, with
non-overlapping `allowPaths` — a rule has exactly one adapter, and a Confluence
page served by a rule whose adapter is `jira` falls through to raw HTML.

## Error codes

`AUTH_FETCH_NO_MATCHING_RULE`, `AUTH_FETCH_AMBIGUOUS_MATCH`,
`AUTH_FETCH_RULE_DISABLED`, `AUTH_FETCH_CREDENTIAL_MISSING`,
`AUTH_FETCH_CREDENTIAL_INVALID`, `AUTH_FETCH_NETWORK_DENIED`,
`AUTH_FETCH_DNS_POLICY_DENIED`, `AUTH_FETCH_REDIRECT_DENIED`,
`AUTH_FETCH_RESPONSE_TOO_LARGE`, `AUTH_FETCH_UNSUPPORTED_CONTENT`,
`AUTH_FETCH_DOCUMENT_TOO_LARGE`, `AUTH_FETCH_DOCUMENT_UNREADABLE`,
`AUTH_FETCH_NOT_AN_IMAGE`, `AUTH_FETCH_IMAGE_TOO_LARGE`,
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
