## 0.5.0 (2026-09-17)

### 🚀 Features

- Keep connections and their audit trail in a database instead of one JSON ([e9a1e66](https://github.com/xarleyn/dsh-plugins/commit/e9a1e66))
  document.

  The store was read, parsed and rewritten whole on every operation, and it held
  the audit trail — the part that grows with usage — inside the same document as
  the connections: every lookup parsed every audit row ever written, and the
  broker appends a row per tool call. A store with a working audit trail made
  each call more expensive than the last. Connections, encrypted credentials,
  per-operation policies and the audit trail are tables now, so a lookup reads the
  row it asks for and a call appends the row it produces.

  Two bounds keep the audit trail finite: `auditRetentionDays` (90 by default,
  0 to keep by age only) and a hard cap of the newest 5000 rows whatever the age
  bound says. Both are applied as rows are written.

  The pre-0.8.0 `qa-integrations.json` is imported on first use — connections,
  credentials, policies and audit — verified inside the transaction, and renamed
  to `qa-integrations.json.migrated-<ISO>`. A leftover file never overwrites a
  live connection: the operator's working credential wins, and the file is left
  where it is.

- Add a sixth provider to the integrations plugin: Test IT, read as the connected ([6ef77da](https://github.com/xarleyn/dsh-plugins/commit/6ef77da))
  QA user through their own API token. It ships twenty-two read-only tools — the
  projects and sections of the test library, test cases, checklists and shared
  steps with their steps, attributes and tags, the change log and comments of a
  case, test plans with their per-plan summary, runs with the test points and
  results inside them, single results with their messages and traces, attachment
  metadata, a bounded text read of a small attachment, autotests and the
  configurations a result is recorded against.

  A Test IT installation is operator configuration: `testit.instances` lists the
  Cloud tenants and on-premise TMS servers this deployment allows, the connect form
  only picks from that list, and the address is re-resolved from config on every
  call, so removing or repointing an instance closes existing connections too. The
  token travels as the `PrivateToken` authorization header and nowhere else.

  The catalog holds GET endpoints only, which is what this package's read-only
  guarantee is written as: Test IT's search and statistics endpoints are all POSTs,
  so the provider reaches the same ground through the GET surface — a run's test
  points instead of its statistics, a plan's summary instead of a filtered
  aggregate — and the tools it cannot back that way are listed as missing in the
  README rather than smuggled in. Three of the reads it does use are the endpoints
  Test IT marks deprecated; they are the only GET reads of those collections, and a
  version that drops them answers an honest "not available here".

  Test IT text is untrusted content: descriptions, steps, comments, messages and
  traces reach the model as bounded blocks under `untrustedContent`, and an
  attachment is described by Test IT itself before a byte is requested, so archives,
  images and oversized files are refused by the server's own account of the file.

- Add a sixth provider to the integrations plugin: Weblate, the localization ([8a92740](https://github.com/xarleyn/dsh-plugins/commit/8a92740))
  platform, read as the connected QA user. It ships nineteen read-only tools —
  the connection itself, projects, components, languages of a component, string
  search, a single string with every plural form and its state, the comments and
  suggestions left on it, checks that fail, statistics and change history — and
  the catalog carries no operation that could change Weblate state, so
  suggestions, comments, edits, approvals, translation files and the repository
  stay out until the confirmation framework exists.

  A connection is one of the operator's configured instances plus a Weblate API
  token, kept in one encrypted credential; the connect form picks the instance
  and never types a host, and the address is re-resolved from deployment config
  on every call, so an instance the operator removes fails closed instead of
  moving a token somewhere else. Token prefixes (`wlu_`, `wlp_`) reach the user
  as a label — personal or project-scoped — and are never treated as a permission
  check.

  Weblate's search grammar is composed by the provider from validated filters
  rather than accepted from the model: values are quoted and escaped, states come
  from Weblate's own `is:` vocabulary, and a follow-up request is reconstructed
  from the page number of the upstream `next` link, only when that link points at
  the configured instance. Every answer that carries upstream-authored text — a
  source string, a translation, a comment, a change — is marked as untrusted
  external content, and localization strings handed to the model are bounded and
  say when they were cut.

- Add a fourth provider to the integrations plugin: Confluence Cloud, read as the ([1abee9d](https://github.com/xarleyn/dsh-plugins/commit/1abee9d))
  connected QA user. It ships eight read-only tools — the connected account and
  site, typed CQL search, a page with its body rendered from Atlassian Document
  Format, page comments with replies, attachment metadata, page versions and
  spaces — and the catalog carries no operation that could change Confluence
  state.

  A connection is an operator-configured site plus an Atlassian API token and the
  account e-mail, kept together in one encrypted credential, and a model tool can
  never name a site, an account or a credential. The site address is re-resolved
  from deployment config on every call, the space allowlist
  (`confluence.allowedSpaces`) is enforced on search and on direct reads alike,
  and every page or comment body reaches the model as untrusted content under its
  own key.

  A search accepts its modification window either as an absolute day or as a span
  counted back from today (`-7d`, `-2w`, `-1m`, `-1y`), resolved against the
  provider's own clock, so an agent whose prompt carries no clock can still ask
  what changed this week.

- Stop retrying GitLab calls the deployment itself timed out, and name a TLS refusal as such. ([3030464](https://github.com/xarleyn/dsh-plugins/commit/3030464))

  The GitLab transport folded every failed fetch — including the abort of its own
  per-request deadline — into a single `ProviderUnavailable` error and spent a
  retry on it. A slow GitLab therefore waited for `timeout × (retries + 1)`
  before the user saw anything, and an untrusted certificate surfaced under the
  same "provider is unavailable" reason as a network outage, sending the operator
  to check reachability instead of the trust store.

  The transport now shares the TeamCity transport's failure classification: an
  aborted deadline is reported as `UpstreamTimeout` and is never re-sent, a
  failed TLS handshake is reported as `TlsFailure`, and only genuinely transient
  network faults are retried. The GitLab settings card carries the same
  human-readable explanations for the two new reasons that the TeamCity card
  already showed. The TeamCity provider's behavior is unchanged.

- Add a fourth integration provider, `jira`. A QA user connects their own ([4183b83](https://github.com/xarleyn/dsh-plugins/commit/4183b83))
  Atlassian account with an API token and gets a read-only catalog of eight tools:
  the connected identity and site; issue search over projects, statuses,
  assignee/reporter, labels and dates; one issue with its description, relations,
  attachment metadata, a comment count and its custom fields; the comments of an
  issue with their visibility; attachment metadata; the transitions available to
  the connected user; one project; and the site's field catalog.

  Sites are operator configuration, never user input: the connect form picks from
  the configured list and sends the e-mail and the token alone, so an arbitrary
  hostname can never reach the broker. A site address is validated at config load
  (HTTPS unless a deployment opts into plain HTTP for a lab, no credentials or
  query in the URL, stable id) and is not stored in the credential — it is
  re-resolved on every call, so removing or repointing a site closes the
  connections made against it instead of silently redirecting a token. The token
  travels as HTTP Basic over `email:token` in the `Authorization` header of a GET
  that never follows a redirect, and the credential is refused outright when it is
  not an Atlassian API token — a pasted URL, a `email:token` pair or a YAML snippet
  never leaves the process.

  The model gets no JQL. Every tool carries typed filters, and the provider builds
  one query from them: values are quoted as JQL string literals with the quote and
  the backslash escaped, control characters are refused, project and issue keys are
  shape-checked, a name where Jira needs an account id is refused (Jira would
  answer an empty page instead), labels are ANDed, and a search without a single
  filter is refused rather than turned into "every issue of the site". Search reads
  the enhanced endpoint Jira Cloud serves today (`/rest/api/3/search/jql`) with
  Jira's own continuation token as the cursor, keeps the page inside the
  deployment's ceiling and Jira's own 100 rows, and never walks pages by itself.
  Issue bodies arrive as Atlassian Document Format and are rendered to bounded
  markdown-like text (headings, lists, code, links, mentions, tables, media
  markers) — a JSON tree and an embedded card are never handed to the model, and
  nothing a node points at is fetched. Custom fields are named from the site's
  field schema, read after the issue answered and never cached, because the same
  site answers a different field list to two users with different permissions.

  The filter vocabulary is the one a corporate Jira is actually asked about, so a
  search can move off a query-string engine without losing questions: project, issue
  type, status and its category (`Done` covers every terminal status, whatever the
  workflow calls it), priority, resolution, components, labels (all of them, not
  any), fix and affected versions including "none set" and "set", assignee and
  reporter, created/updated bounds in both directions, and custom fields either by
  the id the field catalog reported or by an alias the deployment declared. Dates
  take absolute values and Jira's own relative
  tokens (`-3w`, `-2d`), a free-text query is either every word or the exact phrase
  (with each term its own escaped clause, so an `OR` inside a phrase stays a word),
  and the history of one issue is readable through `include: ["changelog_summary"]`
  — bounded to twenty field changes and honest about which of the two cuts
  happened. A person is accepted as `me`, as an account id, or as a name: the name
  is resolved through the site's own user directory, and a name nobody matches or
  several people share is refused with what to do next instead of being spent on a
  query that quietly answers "no such issues".

  `jira.fieldAliases` is where an instance's custom fields get their names: which
  of a site's fields carries "the product" is knowledge about that site, so this
  package carries no field id at all, the mapping is validated when the config is
  resolved (a typo fails the load rather than answering nothing), an unknown name
  is refused together with the aliases that do exist, and `jira_get_fields` hands
  the model the aliases it may use.

  The catalog is an explicit allow-list of Jira Cloud read endpoints, asserted by
  the package gate along with the `GET` method of every entry, the absence of the
  legacy `/search` endpoint Atlassian removed, and the absence of any JQL argument
  in a tool schema. The reads the provider makes beside an operation — the
  deployment type at connect and the people directory behind a name filter — are
  declared in the same allow-list. A deployment type check refuses a Data Center
  instance at connect instead of pretending the Cloud API is compatible.
  Capabilities are bounded by the deployment switches alone (`identity.read`,
  `issues.read`, `comments.read`, `attachments.read`, `transitions.read`,
  `projects.read`, `fields.read`): Jira reports no granted scopes for an API token
  and probing with a write is not an option, so the site's own permissions decide
  upstream and a refusal stays a refusal.

  OAuth 2.0 3LO with rotating refresh tokens, the shared Atlassian
  account/resource layer the specification describes, the workspace-to-project
  binding, the pending-action confirmation flow every write needs, attachment
  content download, a typed filter over the change history (`WAS`/`CHANGED`), the
  caching and per-principal rate limiting stay out of this release; the provider's
  README states each deferred item and what stands in for it today.


### 🩹 Fixes

- Align provider examples and fixtures with the documented public placeholder ([dc105c7](https://github.com/xarleyn/dsh-plugins/commit/dc105c7))
  conventions. No runtime behavior changes.

- Expose account integrations as a feature-owned Plugins tab so the original DSH ([9bc334e](https://github.com/xarleyn/dsh-plugins/commit/9bc334e))
  settings UI can open them from authenticated LAN browsers without depending on
  loopback-only settings discovery.

- Write the operator-configured TeamCity address down where the deployment's ([66a4430](https://github.com/xarleyn/dsh-plugins/commit/66a4430))
  configuration is documented. The "how TeamCity connects" section, the TeamCity
  config example and the end-to-end deployment example all show
  `teamcity.serverUrl` now, and the walkthrough no longer tells users to type the
  server into the connect form — the address is one per stand and comes from the
  deployment, while the form asks for the token alone.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.8.0
- Updated @yadsh/dsh-plugin-log to 0.4.0
- Updated @yadsh/dsh-plugin-kit to 0.2.0

### ❤️ Thank You

- Codex incident cleanup @noreply
- xarleyn @xarleyn

## 0.4.0 (2026-09-16)

### 🚀 Features

- Move the TeamCity address out of the connect form and into the deployment's ([4694ade](https://github.com/xarleyn/dsh-plugins/commit/4694ade))
  configuration. One TeamCity serves the whole stand, so asking every user to type
  the same host only invited a broker pointed at a host of the caller's choosing;
  `teamcity.serverUrl` is now operator input, canonicalized and checked against
  the address policy while the config is resolved, re-checked on every call, and
  never stored in the credential. Repointing or removing it closes every
  connection made against the old value.

  The card shows the configured address as a line of text and asks for the token
  alone. A deployment that mounts TeamCity without an address is valid but inert:
  the card says there is nothing to connect to instead of offering a form whose
  save would be refused. Existing connections keep working — a credential stored
  with the address the old form collected is accepted and read for its token, and
  the token is now spent against the deployment's address.

  `teamcityServer` joins the plugin's RPCs so a card can learn the address without
  one; it is token-gated like the GitLab instance list, because the address of a
  stand's CI is not something an unauthenticated caller needs.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.3.3 (2026-09-16)

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.7.4

## 0.3.2 (2026-09-16)

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.7.3

## 0.3.1 (2026-09-16)

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.7.2

## 0.3.0 (2026-09-16)

### 🚀 Features

- Mount the integrations as a card of the host's "Plugin configuration" tab. A ([3b2f09b](https://github.com/xarleyn/dsh-plugins/commit/3b2f09b))
  connection belongs to a QA account, and until now the only surface that could
  carry it was the `Интеграции` page inside the QA settings dialog: the card of
  the plugins list is dispatched by a settings namespace, and this plugin served
  none. The deployment now installs a mount-only `qa-integrations` section (the
  provider switches, the address policy and the vault path stay composition-time
  decisions, so the section carries nothing an operator could edit), and the
  browser half registers the card under that namespace through the shared
  `dsh-plugin-card` shell.

  The card renders one provider card per mounted provider, exactly as the QA page
  does — both mounts share the component — and reads the account through the new
  `qaUserSession` client service of `@yadsh/dsh-qa-surface`. Without a signed-in
  QA account it says so instead of showing connect forms whose every call would be
  refused, and it stays closed (and therefore reads nothing) until it is opened.

  The credential forms gained the fix they needed to be usable at all: the primary
  button asked for `--dsw-alias-label-on-brand`, a token the DSH theme does not
  define, so the label inherited the card's own colour and the button rendered as
  a grey pill with no text. The status badge and the danger action were painted
  with two more non-existent tokens (`--dsw-alias-success-primary`,
  `--dsw-alias-error-primary`) that cost the status its green and the error box its
  border. All three now use the tokens the first-party cards use, and the package
  gate rejects the dead names.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.7.1

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.0 (2026-09-16)

### 🚀 Features

- Add a second integration provider, `gitlab`, and turn the settings section into ([50f0737](https://github.com/xarleyn/dsh-plugins/commit/50f0737))
  one card per mounted provider. The provider connects a QA user to their own
  GitLab identity with a personal access token and exposes a read-only catalog of
  23 tools: connection identity; project search and project cards; repository tree,
  file reads with metadata, commit lists, single commits and ref comparison;
  cross-GitLab search over projects, issues, merge requests, commits, code and
  comments; issues with their notes; merge requests with changed files,
  discussions, approvals and attached pipelines; and pipelines with their jobs and
  logs.

  Instances are operator configuration, never a user input: the connect form picks
  from the configured list, so an arbitrary hostname can never reach the broker.
  The instance address is validated at config load (HTTPS unless a deployment
  opts into plain HTTP for a lab, no credentials or query in the URL, stable id)
  and is not stored in the credential — it is re-resolved on every call, so
  removing or repointing an instance closes access to tokens minted for it instead
  of silently redirecting them. Requests are GET-only, never follow redirects, and
  carry the token in the `PRIVATE-TOKEN` header alone.

  Capabilities follow the scopes the token really reports: on connect and on every
  connection test the provider asks GitLab what the token holds
  (`/personal_access_tokens/self`) and offers `identity.read`, `projects.read`,
  `repository.read`, `search.read`, `issues.read`, `merge_requests.read` and
  `ci.read` only where the deployment switch and the token agree. A token that
  cannot read itself costs precision, not safety, because the deployment switches
  still bound the surface. Repository files and CI logs are size-bounded before
  they reach the model, binaries and oversized bodies answer with metadata and a
  truncation marker instead of raw bytes, diff text spends a shared character
  budget, and job logs pass through secret redaction — GitLab's own masking is a
  filter, not a promise.

  The write surface, OAuth with PKCE, the user-selectable project boundary, the
  pending-action confirmation flow, caching and webhooks stay out of this release;
  the provider's README states each deferred item and what stands in for it today.

  The shared engine stays provider-agnostic: `parseCredential` gained an optional
  non-secret options map so a connect form can name the instance a token belongs
  to, the error model gained `ResourceNotFound`, `RateLimited` and
  `ResultTooLarge`, and redaction learned the `glpat-` token shape. Package
  verification now asserts the GitLab catalog is read-only, that no tool schema
  carries a user, credential or instance selector, and that neither provider's
  name leaks into the shared modules.

- Extend the Bitrix24 integration from four tools to a read-only catalog of 39, ([a882f1e](https://github.com/xarleyn/dsh-plugins/commit/a882f1e))
  covering CRM context, employees and departments, chats and open lines, tasks,
  calendar and Drive. Each tool is one catalog operation with a validated,
  read-only argument set: CRM schema and funnels, stages and status dictionaries,
  activities with deadlines, timeline comments, stage history, product rows,
  duplicate lookup by phone or e-mail, requisites and AI call transcriptions;
  employee search by name, e-mail or department and the readable employee field
  list; chat search, recent dialogs, message search inside a chat, the chat
  attached to a CRM entity, task or calendar event, its participants and their
  profiles, and open-line dialog history; task search, single task cards, task
  change history, results and logged time; calendar events and free/busy lookup;
  and Drive full-text search, file metadata, storages and folder contents.

  Replace the two capabilities with one per Bitrix24 webhook scope — `crm.read`,
  `chat.read`, `openlines.read`, `user.read`, `department.read`, `tasks.read`,
  `calendar.read`, `disk.read` — and read the scopes the connected webhook was
  actually granted (`scope` method) on connect and on every connection test. The
  Settings card therefore lists a capability as available only when both the
  deployment switch and the portal agree, and a scope granted later in Bitrix24
  appears as a detected but disabled capability that the user enables themselves.
  Owner-scoped reads default to the connected Bitrix24 user, resolved server-side
  from the stored integration, never from a model argument.

  List operations now answer with a uniform `{ items, pagination }` envelope, so
  the model sees one response shape instead of six, and id-keyed responses such as
  open-line history are projected into ordered arrays. Capability labels come from
  the provider at runtime and the effective policy arrives as capability/mode
  pairs, so the Settings card renders a provider it has never heard of.

  The plugin is laid out as one directory per integration under
  `src/providers/`, with the shared engine — broker, repository, secret store,
  tool plumbing — naming no integration at all, which is what the next provider
  (Jira, GitLab, TeamCity) plugs into.

  Three Bitrix24 documentation ambiguities shape the surface: `user.search` is not
  called because its parameter table and its examples disagree about where filter
  keys belong, while `user.get` with `FILTER.NAME_SEARCH` is documented in one
  shape; tasks use the classic methods because REST 3.0 moved to `/rest/api` and
  filters tasks by id only, which cannot express "my open tasks"; and
  `imopenlines.session.open` is not exposed because its page never certifies it as
  read-only, the same dialog lookup being a documented get on
  `imopenlines.dialog.get`.

- Add a third integration provider, `teamcity`, as a read-only catalog of 13 ([83a4760](https://github.com/xarleyn/dsh-plugins/commit/83a4760))
  tools: server identity and version; project search; build configurations; build
  search by project, configuration, branch, status, state and date; one build in
  full; its version control changes; its failures — failed tests and build
  problems in one answer, because "why did this break" is one question; a bounded
  window of its build log; the build queue; investigations; agents; artifact
  metadata; and small text artifacts. Nothing in the catalog can change TeamCity
  state: trigger, retry, cancel, comment and tags wait for the pending-action
  confirmation the specification requires for them, and the parameters endpoints
  are never called, so secret build parameters cannot reach the model at all.

  Unlike GitLab's operator-declared instances, the TeamCity address is user input
  — the server is usually self-hosted — so it is governed by a deployment address
  policy instead of a list: `allowlist` mode with `allowedHosts`, `allowedCidrs`
  and `allowedPorts`, or `trusted-private` for a company network that trusts its
  own DNS. The policy is checked when the connection is stored and again on every
  call, so tightening it closes existing connections rather than only new ones;
  plain HTTP needs an explicit opt-in, ports are explicit (TeamCity's own 8111
  included), redirects are never followed, and the token travels only in the
  `Authorization` header. An empty policy is inert rather than fatal — the plugin
  logs it at startup instead of failing to load — while a typo in it fails loudly,
  because a silently dropped host pattern would leave users with no explanation.

  Log text and artifact text are treated as untrusted external content: the log is
  downloaded up to a byte budget, stripped of terminal control sequences and
  repaired Unicode, redacted, and cut to the requested lines, with `truncated` and
  `logTruncated` telling apart "the window was cut" from "the log is longer than
  what was downloaded". Artifacts are refused by name before a byte is requested
  when they are archives, images, binaries, documents or key material, binary
  bodies answer with metadata instead of bytes, and paths with `..`, absolute
  paths, backslashes, control characters and archive components (`a.zip!/b`) are
  rejected. Lists answer with the same `{ items, pagination }` envelope the other
  providers use, and the provider never follows `nextHref`: `pagination.hasMore`
  says the page was cut, page sizes stay inside the specification's caps, and a
  model that asks for more than the cap gets the cap rather than an error.

  The shared engine gained what this provider needed and nothing else: the error
  model learned `UpstreamTimeout` (a server that did not answer in time is worth
  retrying as it is) and `TlsFailure` (an untrusted certificate is an operator
  problem, not a user one), and redaction learned the shapes a CI job actually
  prints — `password=…`, `api_key: …`, `--token …` — because log text arrives as a
  plain string, where a field-name rule can never see it. Package verification now
  asserts the TeamCity catalog is read-only, that no tool schema carries a user,
  credential or server selector, and that the address policy is enforced on every
  call.

  TeamCity cannot report what a token was restricted to, so capabilities are
  bounded by the deployment switches and by TeamCity's own permissions, which
  surface as `ProviderPermissionDenied` — the provider never tries another
  credential. The address policy, rate limiting, caching, webhooks, automatic
  multi-page aggregation and the write surface stay out of this release; the
  provider's README states each deferred item and what stands in for it today.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.7.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.1 (2026-09-15)

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.6.1

## 0.1.0 (2026-09-15)

### 🚀 Features

- Introduce principal-scoped user integrations for QA Surface with an initial ([0bf810f](https://github.com/xarleyn/dsh-plugins/commit/0bf810f))
  read-only Bitrix24 provider. The plugin adds a first-class Russian Integrations
  settings page, write-only manual webhook setup, envelope-encrypted secret
  storage, per-user policy and audit records, and four narrowly scoped CRM/chat
  tools whose schemas cannot select a user or credential.

  QA Surface gains a public client settings-section registry and owner-attested
  integration principal binding. Admin cross-user viewing, unowned sessions and
  subagents do not inherit access to another account's integration.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.6.0
- Updated @yadsh/dsh-plugin-log to 0.3.1

### ❤️ Thank You

- xarleyn @xarleyn