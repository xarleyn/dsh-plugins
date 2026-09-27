# Deferred scope of the GitLab and Weblate providers, in one place

Issue #213. Every provider carries the work it deliberately left out in three places at once:
the «Чего в …-провайвере ещё нет» list in `README.md`, the `Deferred` / `Non-goals` sections of
its specification, and — for Weblate only — a `Future work` section that mixes what is missing
with what was built differently on purpose. None of the three is complete, they overlap, and
nothing in them says whether a row is waiting for a decision or just waiting for somebody to
write it. The size of the deferred volume could not be read out of any single one of them, so
this file is that single place: one row per deferred item, with what the code does today, the
default that is already on record for it, and what actually blocks it.

This file decides nothing. The `OAuth` versus `Personal Access Token` fork and the nine open
questions of [`providers-gitlab.md`](./providers-gitlab.md) §37 belong to the owner; both are
collected below with the recommended default each one already carries, so answering is a short
act rather than a research task. Nothing here is a licence to write code: rows in the
`owner-decision` bucket stay rows until the owner takes them.

Every row was measured against the code, not against the prose. Citations name a file and the
symbol inside it, so a claim survives a re-indentation; where an item is deliberately absent,
`scripts/verify-package.mjs` is named as the place that enforces the absence, because that is
what makes the row a decision rather than an oversight.

## What the measurement says

- GitLab ships all 23 read operations that §14 of its specification names
  (`GITLAB_OPERATIONS`, `src/providers/gitlab/catalog.ts`, and `name: "gitlab_` counted in
  `src/providers/gitlab/tools.ts`), and every one is a `GET`. The 12 `gitlab_*_prepare` tools the
  same §14 names are the write phase, and none of them is shipped.
- Weblate ships all 19 operations its specification's Tool surface names (`WEBLATE_OPERATIONS`,
  `src/providers/weblate/catalog.ts`), and every one is a `GET`.
- No catalog in the plugin declares a write operation except Bitrix24's, and there is exactly one
  there: `crm.timelineCommentAdd`, capability `crm.comment.write`
  (`src/providers/bitrix24/catalog.ts`, `security: WRITE`). The other six — `gitlab`, `weblate`,
  `jira`, `confluence`, `teamcity`, `testit` — say so in their own header comment: their writes
  wait for a confirmation framework this repository has not built. (Bitrix24's transport POSTs
  every RPC call, reads included, so the transport is not the evidence; the catalog is.)
- No cache, no metrics, no spans, no webhooks, no GraphQL and no MCP transport exist in either
  provider. `scripts/verify-package.mjs` asserts the read-only shape of both catalogs: the
  GitLab one by rejecting `method: "POST|PUT|PATCH|DELETE"` and GraphQL text, the Weblate one by
  rejecting `method:` altogether plus a list of write paths.

So the deferred volume of these two providers is not "more reading". It is four things: writes
and the one framework they all wait for, an identity-and-boundary choice that is the owner's,
the size-and-paging knobs a deployment can already set for Weblate but not for GitLab, and a
tail of items that were never going to be built.

## The buckets

| Bucket | Meaning |
| --- | --- |
| `complete` | Shipped. The row is listed so it is visibly closed, not open. |
| `as-designed` | Shipped, in a different shape from the brief or the specification, on purpose and documented. Not a gap; nobody should "fix" it. |
| `not-doing` | A non-goal. Kept as a row so the list reads as a decision, not as forgetting. |
| `next-step` | Not built. Nothing blocks it but scope and effort. |
| `blocked-shared` | Not built because the whole plugin lacks one mechanism — see «Shared blockers». |
| `owner-decision` | Not the working lane's to take. |

## GitLab

| Item | Declared in | Code today | Default on record | What blocks it | Bucket |
| --- | --- | --- | --- | --- | --- |
| OAuth Authorization Code + PKCE | spec §8.1, README «Чего ещё нет» | PAT only. `"oauth"` exists solely as a value of `IntegrationAuthKind` (`src/types.ts`); no callback route, no `state`, no refresh cycle, and the per-instance `oauth.clientId` / `clientSecret` keys of spec §28 are not in `GitlabFlags` (`src/providers/gitlab/config.ts`) | README «Конфигурация GitLab» already states that no OAuth application is needed | The owner: PAT is the shipped model and OAuth is a second identity path | `owner-decision` |
| User-selectable resource boundary in personal mode | spec §12 (MVP default `selected`) | Service mode only: the administrator's boundary is enforced per call (`assertInsideBoundary`, `listBoundedProjects`, `src/providers/gitlab/index.ts`), with `groups` handled beside `projects`. In personal mode access is exactly what the token grants | §37: group inheritance "explicit and visible" | §37 question 2 (group inheritance) and the selection UI; the enforcement code already exists to reuse | `owner-decision` |
| Pending actions and two-phase confirmation | spec §15, plugin `SPEC.md` §18 | Absent. The broker denies every call whose capability policy is not exactly `allow` (`src/broker.ts`, and `src/repository.ts` seeds `allow` for all requested capabilities at connect), so the stored mode `confirm` behaves as a denial and there is nothing to confirm into | `SPEC.md` §18 fixes the flow and a 5–15 minute expiry; spec §15 says 10–30 | One shared framework; see `S1` | `blocked-shared` |
| Phase 2 writes: issue comment, issue create/update, MR comment, MR create/update | spec §35 Phase 2, §14 (`*_prepare` tool names) | Absent from `GITLAB_OPERATIONS`; the 12 `gitlab_*_prepare` tools §14 names are not in `src/providers/gitlab/tools.ts` | §37: comments confirmed by default | `S1`, then the `api` scope upgrade | `blocked-shared` |
| Phase 3 CI actions: run, retry, cancel a pipeline, play a manual job | spec §35 Phase 3 | Absent | §37: CI writes confirmed always in early versions | `S1` | `blocked-shared` |
| Phase 5 advanced operations: approve, merge, repository writes, branch and tag operations | spec §35 Phase 5, §3 Non-goals | Absent | §35 requires an explicit threat review per operation; §3 forbids auto-merge and direct pushes outright | a threat review, not code | `not-doing` |
| Custom CA bundle and private-network policy per instance | spec §2.2, §7, §28 (`tls.caBundle`, `network.allowPrivateAddresses`) | Absent: `GitlabInstance` carries `id`, `label`, `baseUrl` only (`src/providers/gitlab/config.ts`), and the shared address kernel (`src/providers/kernel/address.ts`) has no trust anchor, so a self-managed instance behind a private CA answers `TlsFailure` (`src/errors.ts`) with nothing the operator can set to fix it | nothing written down | the host's fetch stack: no per-request CA is dialable today; TeamCity is the precedent for the CIDR half (`src/providers/teamcity/network.ts`) | `next-step` |
| Page-size and result-size knobs | spec §18 (`defaultPageSize`, `maxPageSize`, `maxToolResultBytes`, `maxDiffBytesToModel`), §28 | Partial. `perPage` is clamped to `LIST_MAX_PER_PAGE = 100`, hard-coded (`src/providers/gitlab/operations.ts`); diffs are capped by `DIFF_BUDGET = 200_000`, also hard-coded; the body cap is the deployment-wide `maxResponseBytes` (2 MB, `src/config.ts`), not the 256 KB §18 names. Shipped knobs: `maxFileBytes`, `maxJobLogBytes`, `maxSearchResults`, `retries` | §18's own numbers: 20 by default, 100 ceiling | nothing — Weblate already ships the same shape (`maxPageSize`, `DEFAULT_PAGE_SIZE`) | `next-step` |
| Continuation cursor for a large answer | spec §18 ("stable continuation cursor or page token") | Absent. Paging is stateless `page` / `perPage`; a body over the cap answers `ResultTooLarge` and there is no way to read it in pieces | §18 | see `S2` | `blocked-shared` |
| Cache | spec §21 | Absent — no cache of any kind in either provider, which is also why no cross-user leak through one is possible | §37: repository cache "minimal / short TTL"; §21 constrains a cache rather than requiring one | §37 question 3 (cache repository content at all?) | `owner-decision` |
| Webhooks | spec §23 | Absent: no public callback route, no event normalization | §23 says not required for MVP; §37: opt-in | §37 question 8, and `S2`-class cache invalidation it is paired with | `owner-decision` |
| Official GitLab MCP backend | spec §24, §3 (do not assume it as the MVP backend) | Absent. `mcp_token` is a value of `IntegrationAuthKind` (`src/types.ts`) with no code path behind it | §24: REST v4 is canonical; an MCP transport may be added later, never a full automatic `tools/list` | — | `not-doing` |
| GraphQL | spec §25, §35 Phase 5 | Absent: REST v4 only | §25 keeps GraphQL "narrowly where justified" | a per-query justification | `not-doing` |
| `defaultPolicy` block per provider | spec §28 (`reads: allow`, `commentsWrite: confirm`, …) | Absent as a config surface: the policy is per capability, stored per integration and defaulted to `allow` at connect (`src/repository.ts`) | — | follows `S1`: a write policy is meaningless while no write exists | `blocked-shared` |
| §36 read-only MVP acceptance checklist | spec §36 | 18 boxes, none ticked, and several of them name items this table marks deferred (OAuth, numeric-ID resource restriction, cache namespacing, token refresh) | — | a documentation decision: re-label the checklist per phase, or mark each box with the phase that owns it | `next-step` |

## Weblate

| Item | Declared in | Code today | Default on record | What blocks it | Bucket |
| --- | --- | --- | --- | --- | --- |
| All writes: suggestion, comment, edit target, approve, translation file upload/download, autotranslate, repository pull/commit/push | spec `Deferred`, `Non-goals`, `Write operations`, README «Чего ещё нет» | Absent by construction: `WEBLATE_OPERATIONS` carries no `method:` at all and the package gate rejects `method:` plus the repository / file / autotranslate / addons / links / lock / announcements / backups paths (`scripts/verify-package.mjs`) | spec `Write operations`: "a suggestion is the right first write", and only after the two-phase flow exists | `S1` | `blocked-shared` |
| Bounded screenshot download | spec `Screenshots and binary data`, `Future work`, README | Metadata only: `unitIds`, `fileUrl` and `webUrl`; the image endpoint is not reachable and the address is never dialled (`src/providers/weblate/operations.ts`) | spec `Future work`: needs a size budget, a MIME policy and a per-principal temporary file lifecycle first; listed as next step 2 | those three policies, none of which exists yet | `next-step` |
| Per-unit change history | spec `Change history`, README | Not possible upstream: Weblate exposes changes per project, component and translation. `changes.list` is project-scoped and every row carries its `unitId` (`src/providers/weblate/operations.ts`) | spec `Change history`: follow a string through the ids its rows carry | — | `not-doing` |
| Arbitrary `q` search string | spec `Search and filters`, `Non-goals`, README | Refused: tools compose typed filters, `quoteQueryValue` quotes every value and control characters are rejected outright (`src/providers/weblate/query.ts`) | spec `Non-goals` | — | `not-doing` |
| `note` as a searchable field | README «Чего ещё нет» | Reachable in the grammar, unreachable from the model: `UNIT_TEXT_FIELDS` declares `source`, `target`, `context`, `note` (`src/providers/weblate/query.ts`), while the tool schema and the query builder pass only the first three (`src/providers/weblate/tools.ts`) | nothing written down | nothing — one argument, one description. See «What the lists omit» | `next-step` |
| Capability discovery and `CAPABILITY_UNAVAILABLE` | spec `Permissions`, `Compatibility`, README | Absent, and the code does not exist even as an error code (`src/errors.ts`). A read this release does not offer answers `405` and is folded into `ResourceNotFound` with a message naming the cause (`src/providers/weblate/transport.ts`) | spec `Future work`: Weblate reports nothing per token and the provider refuses to infer rights from one successful read | — | `not-doing` |
| Cache | spec `Caching`, README | Absent, and the spec calls that a property rather than a gap: a permission change takes effect on the next call, and nothing non-`GET` can be replayed | spec `Caching`: if a localization index is ever added it must be partitioned per account or principal | — | `not-doing` |
| Per-account rate limit, concurrency limiter, circuit breaker | spec `Rate limiting`, README | Partial. Retries honour a numeric `Retry-After` and otherwise back off with jitter (`backoff`, `src/providers/kernel/read-policy.ts`); pages are bounded by `maxPageSize`; service-mode calls are already ceilinged per principal and per shared credential (`ServiceRateLimiter`, wired in `src/broker.ts`). What is missing is the same thing in personal mode | spec `Rate limiting`: on a deployment where those matter "they belong in the shared layer rather than in one provider" | a shared-layer card, not a Weblate card | `next-step` |
| Segment or range read of an oversized body | spec `Response size controls`, README, `Next steps` 1 | Absent: a body over `maxResponseBytes` answers `ResultTooLarge`; strings are clipped and marked (`textTruncated`), never handed over in pieces | spec `Response size controls`: inventing a continuation token for a body the provider refused to read would be worse than saying so; it is next step 1 | see `S2` | `blocked-shared` |
| SSRF policy by CIDR and DNS | spec `API base`, README | Deliberately not the model: the rule is the operator's instance list plus HTTPS by default (`src/providers/kernel/address.ts`), and "declared by the operator" replaces "public address" | spec `API base`, README «Как подключается» | — | `not-doing` |
| Provider metrics and OTel spans | spec `Observability`, README | Absent anywhere in the plugin. The audit row keeps provider, operation, result and source session id (`src/repository.ts`), and no localization text enters it | spec `Observability` | a shared-layer card, see `S4` | `next-step` |
| Capability-policy view per instance | spec `Next steps` 4 | Absent; a policy is per capability today, with no per-instance reading surface in the card | spec `Next steps`: only "if operators start running several" | a condition, not a blocker | `next-step` |
| Connection verification | brief §9.2 via spec `Future work` | Shipped differently: Weblate has no current-user endpoint, so the token is proved through `/users/?page_size=2` and the account is read out of the single row an unprivileged token sees (`src/providers/weblate/index.ts`) | spec `Future work` | — | `as-designed` |
| Capability ids (`read:projects`, `write:suggestions`, `high_impact:*`, `dangerous:*`) | brief §11 via spec `Future work` | Shipped as `identity.read`, `projects.read`, `units.read`, … ; no write or high-impact id exists because no operation could need one | spec `Future work` | — | `as-designed` |
| Brief input names (`query`, `failingChecksOnly`, `limit`, `cursor`) | brief via spec `Future work` | Shipped as typed filters plus `page` / `perPage` with `pagination.nextPage` | spec `Future work` | — | `as-designed` |
| Stored `token_kind` | brief §7.5 via spec `Future work` | Derived from the stored token at validation time and shown in the display name (`tokenKind`, `src/providers/weblate/index.ts`), so no column can go stale | spec `Future work` | — | `as-designed` |
| HTTP routes `/api/me/integrations/weblate` | brief §24 via spec `Future work` | Mounted as host RPC methods on the plugin namespace; the user id is never a parameter | spec `Future work` | — | `as-designed` |

## Shared blockers

Four mechanisms are deferred by more than one provider at once. Each one is a card on its own;
none of them is provider work.

### S1 — the confirmation framework (pending actions)

The single gate in front of every write in this plugin. `SPEC.md` §18 and GitLab spec §15 both
describe it; neither exists. Today a policy mode other than `allow` is a denial
(`src/broker.ts`), so there is no second phase to confirm into — which is exactly why six
provider catalogs say their writes wait.

What a card has to carry, and nothing more: a server-side pending payload sealed by the
provider and bound to principal, session, integration, instance and resource; an immutable hash
so the previewed text cannot change before confirmation; an expiry; single use; invalidation on
disconnect; a re-check of ownership and policy at confirm time; a qa-surface confirmation card;
and the change in `src/broker.ts` that makes `confirm` mean "ask", not "refuse".

Two facts the card must settle rather than inherit:

- the expiry differs between the two documents (5–15 minutes in `SPEC.md` §18, 10–30 in GitLab
  spec §15);
- Bitrix24 already ships the plugin's only write — `crm.timelineCommentAdd`, capability
  `crm.comment.write` (`src/providers/bitrix24/catalog.ts`) — and it runs under a plain `allow`,
  with no preview and no confirmation. The card has to decide whether that write retro-fits into
  the framework or stays the pre-framework exception it is today.

Unblocks: GitLab phases 2 and 3 (12 tools), the whole Weblate write set, and the same sentence
in the `jira`, `confluence`, `teamcity` and `testit` catalogs.

### S2 — a segment or range read of a body over `maxResponseBytes`

Both providers answer `ResultTooLarge` and stop. It is Weblate's own next step 1, and GitLab
spec §18 asks for the continuation token that was never built. Shared because the cap lives in
the deployment config (`src/config.ts`), not in either provider.

### S3 — egress policy: CIDR ranges, DNS and a per-instance trust anchor

TeamCity already has the CIDR half (`src/providers/teamcity/network.ts`, `network.allowedCidrs`
and `mode: allowlist | trusted-private`). GitLab needs the TLS half — the `tls.caBundle` of its
§7 and §28 — and both providers would consume whatever the shared layer is given. Blocked on
the host's fetch stack rather than on this plugin.

### S4 — provider observability

No provider publishes metrics or spans; the audit table is the only record. One shared-layer
card, six beneficiaries.

## What the two human-facing lists omit

Found while measuring, none of it in any «Чего ещё нет» list. Each row is either a one-paragraph
documentation fix or a small card; none of them needs the owner.

1. **GitLab has no page-size knob while Weblate has one.** `LIST_MAX_PER_PAGE` and `DIFF_BUDGET`
   (`src/providers/gitlab/operations.ts`) are hard-coded where spec §18 names `defaultPageSize`,
   `maxPageSize` and `maxDiffBytesToModel`, and the body cap is the deployment's 2 MB rather
   than §18's 256 KB. A deployment cannot lower GitLab's footprint the way it can Weblate's.
2. **GitLab spec §36 cannot go green as written.** Its "acceptance criteria for read-only MVP"
   list still names OAuth, numeric-ID resource restriction, cache namespacing and token refresh
   — deferred items in this table — while README states the read-only phase as shipped. Either
   the checklist is labelled by phase or each box names the phase that owns it; today the two
   documents describe different definitions of the same milestone.
3. **GitLab spec §28's per-instance keys are not implemented and not listed as deferred.**
   `oauth.clientId` / `clientSecret`, `tls.caBundle`, `network.allowPrivateAddresses` and the
   `defaultPolicy` block appear in a configuration example that README does not reproduce, so a
   reader cannot tell the shape of the future config from the shape of the shipped one.
4. **Weblate's `context` description promises a search that does not happen.** The tool argument
   reads "substring of the string's context or developer comment" (`CONTEXT_HINT`,
   `src/providers/weblate/tools.ts`), while the composed query only ever searches `context` —
   the developer comment is Weblate's `note` field, which no argument reaches
   (`UNIT_TEXT_FIELDS` in `src/providers/weblate/query.ts`). README describes the filters
   correctly (`«Возможности и скопы Weblate»` names `source`, `target`, `context`, `state`), so
   the promise exists only where the model reads it. Either the description shrinks to what is
   true, or `note` becomes the fourth filter.
5. **The expiry of a pending action is written down twice, differently** — `SPEC.md` §18 versus
   GitLab spec §15. `S1` cannot start without picking one.

## The nine §37 questions, and what the recorded default does not settle

§37 of the GitLab specification already carries a "Recommended defaults" block for all nine.
Adopting them is one act; each row below says what the default does *not* decide, because that
is the residue a decision still owes.

| # | Question | Recommended default | Still unsettled by it |
| --- | --- | --- | --- |
| 1 | Several GitLab identities per user on one instance? | data model yes, UI later | which UI, and whether the credential card offers the switch |
| 2 | Group inheritance automatic or explicit expansion? | explicit and visible | the personal-mode boundary row above, which is the one that blocks |
| 3 | Cache repository content, or metadata only? | minimal, short TTL | whether any cache is worth building before webhooks can invalidate it |
| 4 | Confirmation for every comment, or opt-in auto-approve for low-risk writes? | confirmation by default | whether opt-in is ever offered, and who may turn it on |
| 5 | User-level auto-approve for pipeline retry/cancel? | never, in early versions | the CI risk class itself |
| 6 | Subagents inherit GitLab capability, or need a delegation grant? | explicit principal inheritance only | the delegation grant's shape, which `SPEC.md` §21 leaves future |
| 7 | Scheduled jobs on user OAuth credentials? | disabled until a delegated-execution model exists | that model |
| 8 | Webhook setup automatic or manual? | opt-in | who configures it: operator or administrator |
| 9 | Official MCP as a backend once out of Beta? | optional future backend, never automatic full exposure | nothing — §24 already forbids the failure mode |

## What to take, as a proposal for the owner

Ordered by what each step unlocks, not by size. Struck through, changed or ignored by the owner
as they see fit — the point is that a decision here is a one-line edit, not a re-read of six
documents.

1. `S1`, the confirmation framework. It is the only row that unblocks a whole phase: 12 GitLab
   tools, the Weblate suggestion, and the identical sentence in four other catalogs. Its two
   open facts (expiry, and the Bitrix24 write that predates it) are cheap to settle.
2. `S2`, the segment read. Small, shared by both providers, and it is Weblate's own next step 1.
3. GitLab page-size and diff-size knobs. Parity with Weblate, no decision attached, and it is
   the one item on this list a deployment can ask for next week.
4. `S3`, the trust anchor for self-managed GitLab. Enterprise-only, blocked on the host's fetch
   stack, and worth a card rather than a wait.
5. The two documentation fixes this file exists to make unnecessary: §36's checklist and §28's
   config sample.

Everything in the `owner-decision` bucket — the OAuth fork, the personal-mode boundary, whether
to cache at all, whether to accept §37's defaults — stays parked until the owner answers. The
`not-doing` and `as-designed` rows should stop being re-read as backlog: the cheapest edit here
is to say so in the README lists themselves.

## How to re-measure this

The claims above are all re-checkable without reading a line of prose:

```bash
# the tool surface of each provider: 23 shipped GitLab reads, 19 Weblate reads
grep -c 'name: "gitlab_' plugins/dsh-qa-integrations/src/providers/gitlab/tools.ts
grep -c 'name: "weblate_' plugins/dsh-qa-integrations/src/providers/weblate/tools.ts

# the write tools §14 names and none ships: 12
sed -n '/## 14. Tool surface/,/## 15./p' \
  plugins/dsh-qa-integrations/docs/specs/providers-gitlab.md \
  | grep -o 'gitlab_[a-z_]*_prepare' | sort -u | wc -l

# the transport POST is Bitrix24's RPC shape, not a declared write; the catalog is the evidence
grep -rn 'method: "\(POST\|PUT\|PATCH\|DELETE\)"' plugins/dsh-qa-integrations/src/providers
grep -rn 'security: WRITE' plugins/dsh-qa-integrations/src/providers/*/catalog.ts

# the read-only invariant is a gate, not a comment
grep -n 'weblateCatalog\|gitlabCatalog' plugins/dsh-qa-integrations/scripts/verify-package.mjs

# policy modes and what a non-allow call does
grep -n 'IntegrationPolicyMode\|mode !== "allow"' plugins/dsh-qa-integrations/src/{types,broker}.ts
grep -n "VALUES (?, ?, 'allow')" plugins/dsh-qa-integrations/src/repository.ts

# which knobs a deployment can actually set, against §18's list
grep -n 'readonly [a-zA-Z]*:' plugins/dsh-qa-integrations/src/providers/gitlab/config.ts
grep -n 'LIST_MAX_PER_PAGE\|DIFF_BUDGET' plugins/dsh-qa-integrations/src/providers/gitlab/operations.ts
```
