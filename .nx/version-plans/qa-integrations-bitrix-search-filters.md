---
"@yadsh/dsh-qa-integrations": minor
---

Give `bitrix_search_crm` the filters the audit kept reaching for, and pin the page order so offset paging stops repeating rows.

The tool could only narrow by title substring and assignment, so typical questions ("open deals in this funnel", "what moved recently") degenerated into paging through the archive from the first page of ten thousand. The schema now carries `stageId`, `categoryId`, `openOnly` (deals only — the universal item API exposes `closed` for deals), `createdSince`, `updatedSince`, `orderBy` (`id`/`createdTime`/`updatedTime`) and `orderDir`. Every search now sends an explicit deterministic order: offset paging over an unspecified order is what produced identical pages at different offsets. An empty `query` now fails with the repair named in the message — `query is invalid: a non-empty title substring …` — instead of a bare `query is invalid` that one session retried verbatim; the tool description also points at `bitrix_get_crm_stage_history` for the "sitting in a stage too long" question the search could not express.
