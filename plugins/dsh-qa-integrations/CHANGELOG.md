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