# Manual verification playbook

What a human runs against a **real instance** of a service, because a gate
cannot: a gate never dials anything. [VERIFICATION.md](VERIFICATION.md) is the
map of what the automated gates prove; this page is how to prove the three
things they cannot —

1. the operator's address actually resolves and answers;
2. the credential the deployment holds is accepted by *that* product;
3. the API the provider speaks is the API the instance serves.

All three failures look identical from inside the test suite: green. The
expensive one is the third, and it has already happened once in this repository
— a provider written against Atlassian Cloud was pointed at a Server / Data
Center instance, so every tool of that provider could never work, and it took a
hand-written `curl` session on the stand to find out.

Use this page when: you add or change a provider, add a *second product* to an
existing one (see [Adding a second product](#adding-a-second-product-to-a-provider)),
you are verifying a release against a stand, or a user reports "the tools do
not answer".

Everything below uses synthetic addresses (`jira.example.corp`,
`git.example.com`, «Демо-продукт») so this page can live in a public
repository. The deployment's own stand steps — real hosts, its compose file,
its tokens — belong to the deployment kit, not here.

## 1. The five-minute probe

`scripts/probe-provider.mjs` dials the instance **through the provider's own
built code** — its transport, its catalog paths, its product dialect. It
therefore cannot disagree with the plugin: if the probe works, the plugin works
against that address.

```bash
pnpm --filter @yadsh/dsh-qa-integrations build    # the probe reads lib/

# the token is never a command-line argument: it leaks into shell history
# and into the process list
export PROBE_TOKEN='…'        # or keep it in a file and use --token-file

node scripts/probe-provider.mjs \
  --provider=jira \
  --base-url=https://jira.example.corp \
  --token-env=PROBE_TOKEN
```

What it prints, and how to read it:

| Line | Meaning |
| --- | --- |
| `the instance answers "…" (/rest/api/2)` | the product was asked **before** any credential was spent; nothing to declare by hand |
| `connected: <name> (<id>)` | the credential is accepted and the identity read works |
| `capabilities: N` | how many reads this deployment enabled — not what upstream allows |
| `paths this provider will call for <op>: …` | which endpoints the provider believes in, from its own catalog |
| `operation <op> → {…}` | the shape of a real answer (counts and key names, never whole bodies) |

Exit code 0 means everything above worked. Anything else is the provider's own
refusal, printed verbatim, because that is what the connect card would have
shown. Two refusals are worth recognising:

- **A product mismatch** prints the product the instance answered and the value
  to declare. Re-run with `--deployment=server` (or `cloud`) and it will
  connect against the right API root, with the right authentication.
- **`Use the e-mail of the Atlassian account…`** means the site is declared
  Cloud, where an API token is spent as `email:token`; a Server / Data Center
  personal access token needs no account. The probe asks the instance which it
  is, so this only appears against a site it could not ask.

Useful flags: `--deployment=cloud|server` (Atlassian only, to prove a specific
declaration), `--op=<operation> --arg key=value` (read something real; a value
that parses as JSON is passed as JSON), `--email=…` (Cloud connections),
`--allow-insecure-http` (a development stand over plain HTTP), `--json` (the
whole report, for a bug report), `--token-file=<path>`.

**What it never does:** print a token (every line goes through a redactor that
masks the literal secret and any `Basic`/`Bearer`/`PrivateToken`/`Token`
header), write anything upstream, or read an operation the deployment did not
enable.

The probe dials with its own one-connection-per-request transport (Node's
`fetch` leaves a keep-alive socket behind, which on Windows aborts the process
after a successful report) and refuses to follow a redirect, for the same reason
the providers do. The provider's own transport still runs on top of it: the
catalog paths, the authentication and the parsing under test are the plugin's.

## 2. Per-provider acceptance

Run the probe first; then walk the reads by hand through the agent (or the
tools) — one per capability group. Arguments are the ones a stranger could
supply without internal data.

### Jira

| Step | What to do | Expected |
| --- | --- | --- |
| Address | operator declares `jira.sites[]` and, for a self-hosted instance, `deploymentType: server` | the site answers `/rest/api/2` with `deploymentType: "Server"`/`"Data Center"` |
| Identity | probe, no `--op` | `connected:` names the account; on Server / Data Center the id is the **login** (`name`), on Cloud the `accountId` |
| Issues | `jira_search_issues` with `projectKeys: ["PROJ"]` (a project **key** has no dash; `PROJ-123` is an *issue* key) | `items[]` with `key`, `url`, `status`, `assignee` |
| One issue | `jira_get_issue` `issueKey: "PROJ-123"`, `include: ["description","custom_fields"]` | description as text — wiki markup on Server / Data Center, ADF rendered on Cloud |
| Comments · transitions · attachments | `jira_get_issue_comments` / `…_available_transitions` / `…_attachments` on the same key | rows with `author`, `body`; transitions with `requiredFields`; attachment metadata |
| Fields | `jira_get_fields` | field names plus the aliases the operator declared |
| Continuation | search again with `cursor` from the previous answer | Server / Data Center continues at an offset, Cloud with its own token |

Sharp edges: a 403 is a permission answer, not a broken token; a name filter
resolves through the site directory and refuses ambiguity on purpose (pass the
identifier an issue reported); `fieldAliases` are the operator's own names for
this instance's custom fields.

### Confluence

| Step | What to do | Expected |
| --- | --- | --- |
| Address | `confluence.instances[]`, plus `deploymentType: server` for a self-hosted wiki, and **any context path in `baseUrl`** (`https://wiki.example.corp/confluence`) | Server / Data Center answers under `/rest/api`, Cloud under `/wiki` |
| Identity | probe | `connected:` names the account (Cloud: `accountId`, Server / Data Center: user key/login) |
| Search | `confluence_search` `query: "демо"` | rows with `id`, `title`, `space.key`, `url` |
| Page | `confluence_get_page` `pageId: "123456"` | `page.space.key`, `page.version`, body as text; Server / Data Center bodies come from storage markup, Cloud from ADF |
| Comments | `confluence_get_page_comments` (`kind: footer` / `inline` / `all`, `includeReplies: true`) | Server / Data Center stores both kinds in one collection and marks each; `kind` still filters |
| Spaces | `confluence_list_spaces`, `confluence_get_space` `space: "DEMO"` | rows with `key`, `name`, `type`; a numeric id is a Cloud v2 address — on Server / Data Center use the key |
| Attachments · versions | `confluence_get_page_attachments` / `…_versions` `pageId` | metadata only; a `downloadLink` is handed over, bytes are never fetched |

Sharp edges: the space allowlist (`allowedSpaces`) and the service boundary are
enforced on *every* read — a page outside them is refused, not silently
trimmed; a 404 may mean "not visible to this account".

### GitLab

| Step | What to do | Expected |
| --- | --- | --- |
| Address | `gitlab.instances[]`, `https://git.example.com` (a relative-URL install keeps its context path) | paths are built as `<baseUrl>/api/v4/…` |
| Identity | probe | `connected:` = `Name (@username)`, plus the token scopes the provider could read back |
| Project | `gitlab_project_get` `project: "group/project"` | project card with visibility and default branch |
| Code | `gitlab_repository_file_get` `project`, `path: "README.md"` | file body (bounded); a very large file is answered as truncated |
| Issues · MRs · pipelines | `gitlab_issue_get` `iid: 1`; `gitlab_merge_requests_list`; `gitlab_pipelines` | rows; a job log is redacted text |

Sharp edges: a 404 on a confidential issue means "not visible through this
credential"; `read_api` is the scope that matters, and any mutating scope is
reported as unsafe; approvals may 404 on lower tiers by design.

### TeamCity

| Step | What to do | Expected |
| --- | --- | --- |
| Address | `teamcity.serverUrl`, **plus `teamcity.network`**: `allowedHosts: ["teamcity.example.corp"]` (or `mode: trusted-private`), and a non-standard port in `allowedPorts` | a default deployment allows nothing: the first refusal is usually the policy, not the server |
| Identity | probe | `connected:` = account · `TeamCity <version>` |
| Builds | `teamcity_builds` with `projectId` / `limit` | rows; there is no cursor — ask for a bigger limit instead |
| One build · log · artifacts | `teamcity_build` `buildId: "123"` (numeric id, not the build number), `teamcity_build_log`, `teamcity_artifacts` | the log is windowed text; archive-type artifacts are refused by name |

Sharp edges: the address policy is re-checked on every call, so tightening it
closes existing connections; `400/405/406/422` are request errors, not server
faults.

### Bitrix24

| Step | What to do | Expected |
| --- | --- | --- |
| Address | the incoming-webhook URL itself, `https://demo.bitrix24.ru/rest/1/abcdefghij/`; the portal suffix must be in `allowedPortalSuffixes` | everything is `POST <origin>/rest/<user>/<secret>/<method>.json` |
| Identity | probe | `connected:` = the webhook's portal and the name on it |
| CRM · tasks · files | `bitrix_search_crm` `entityTypeId: 2`, `bitrix_get_task` `taskId: 1`, `bitrix_search_files` `query: "отчёт"` | rows; paging uses `start` (CRM/tasks) or `OFFSET` (`im.*`) |

Sharp edges: the secret **is** part of the URL, so it must never be echoed; a
failed call often arrives as HTTP 200 with an `error` body, which the provider
folds into one refusal; the one write (`bitrix_add_crm_timeline_comment`) is off
by default.

### Test IT

| Step | What to do | Expected |
| --- | --- | --- |
| Address | `testit.instances[]`, Cloud `https://team.example.testit.software` or an on-prem address | paths are `<baseUrl>/api/v2/…` |
| Identity | probe | **no account line**: Test IT v2 exposes no token owner, so the identity is the instance label plus how many projects the token sees |
| Projects · runs · results | `testit_projects`, `testit_test_runs` `projectId: "<uuid>"`, `testit_test_run_results` `testRunId` | rows; ids are UUID-shaped |
| Attachments | `testit_attachment_metadata` `attachmentId` | metadata, then a bounded text body; archives are refused by name |

Sharp edges: some endpoints are deprecated upstream and may answer 404 on newer
releases; there is no text search at all (those endpoints are POST).

### Weblate

| Step | What to do | Expected |
| --- | --- | --- |
| Address | `weblate.instances[]`, context path allowed (`https://weblate.example.com/hosted`) | paths are `<baseUrl>/api/…` |
| Identity | probe | `connected:` names the account when the token's answer holds exactly one user; otherwise the provider says the account is unknown rather than guessing |
| Projects · components · units | `weblate_projects_list`, `weblate_project_get` `project: "demo"`, `weblate_units_search` `project`, `component`, `language: "de"` | rows; `perPage` is clamped, never refused |

Sharp edges: `405` is reported as "this Weblate release does not offer the
operation"; a project the token cannot see answers an error, not an empty list.

## 3. Atlassian: two products behind one name

Both Atlassian providers serve two products, and the deployment **declares
which one** (`deploymentType: cloud | server`, default `cloud`). A wrong
declaration is refused at connect with the value that fixes it.

| | Atlassian Cloud | Server / Data Center |
| --- | --- | --- |
| Jira API | `/rest/api/3` | `/rest/api/2` |
| Confluence API | `/wiki/api/v2` + `/wiki/rest/api` | `/rest/api` under the instance's own base |
| Credential | API token + account e-mail, HTTP Basic | personal access token, `Bearer`, no e-mail |
| Jira search | `/search/jql`, continuation token | `/search`, row offset + total |
| User filter | account id (`query=` lookup) | user name (`username=` lookup) |
| Page body | Atlassian Document Format | storage markup |

Acceptance for a self-hosted wiki: put the context path in `baseUrl`
(`https://wiki.example.corp/confluence`), not in a path the provider appends.

## 4. Adding a second product to a provider

The recipe that would have caught the Atlassian data-centre gap **before** the
code was written. Do these in order and write the answers down; a mismatch here
is a design decision, not a bug to discover later.

1. **Ask the instance what it is.** `node scripts/probe-provider.mjs --provider=<p> --base-url=<address> --token-env=…`
   — the product line comes back without any credential.
2. **Probe the same address both ways.** Run it again with the other
   `--deployment`. The product the provider would speak must match what the
   instance serves; if the second product answers a different API root, a
   different authentication scheme or a different answer shape, say so in the
   spec before writing code.
3. **Count the differences** and write them into the provider's spec: API root,
   authentication, paging, identity field, body format, and every endpoint that
   does not exist on one of the products.
4. **Keep the paths in one catalog** (both products, side by side) and the
   differences in one dialect module — never a second copy of the provider.
5. **Extend the package gate** so the second product's endpoints are declared,
   read-only and in step with the first product's list; a gate that only knows
   one product stops protecting the moment the second one lands.
6. **Run this playbook against both products** on the stand, and paste the
   probe output of both into the PR.

## 5. Negative cases worth running by hand

These are the ones a gate cannot prove either, and each has a distinct message
the user must be able to read:

- **Wrong product declared** — declare `cloud` for an instance that answers
  `Data Center`: the connect must refuse *and* name the value to set.
- **Missing account** — a Cloud site whose stored connection has no e-mail (the
  site was repointed from server to cloud): refuse with `CredentialRevoked`,
  do not send an empty-account Basic pair.
- **Expired or revoked token** — rotate the token in the product, keep the old
  one in the plugin: the next call answers `CredentialRevoked`, and the card
  asks for a new token rather than retrying forever.
- **A read the operator switched off** — disable one capability
  (`jira.issuesRead`): the tool must not exist for the user, and the operation
  must refuse if it is reached anyway.
- **A resource outside the allowlist / boundary** — a page in a space outside
  `allowedSpaces`, an issue in a project outside a service profile's boundary:
  refused, never silently trimmed.
- **A name filter that resolves to nobody, or to several people** — refused
  with the identifier to pass instead of an empty page.

## 6. Recording the result

Paste into the PR (or the deployment's round playbook) the smallest set that
lets a reviewer re-run it:

```text
probe:  node scripts/probe-provider.mjs --provider=jira --base-url=… → <first four lines>
reads:  jira_search_issues PROJ → 3 items; jira_get_issue PROJ-123 → description 512 chars
        confluence_get_page 123456 → space DEMO, version 3, body 4 210 chars
deviations: none | <what differed, what you did instead>
```

A deviation is not a failure: a stand that answers differently is exactly what
this page is for. What must not happen is a deviation nobody wrote down.

## See also

- [VERIFICATION.md](VERIFICATION.md) — what the automated gates assert, and
  which of them a change touches.
- [PLUGIN_GUIDELINES.md](PLUGIN_GUIDELINES.md) — the rules behind those gates.
- `plugins/dsh-qa-integrations/docs/specs/providers-*.md` — the per-provider
  specifications, including the compatibility sections that name which products
  a provider speaks.
