# Grounded document workflow

The existing QA agent prepares a proposal or specification from requirements, product evidence and a registered content template. Markdown is the reviewable source; DOCX is an export of an approved immutable revision.

## Lifecycle and authority

`intake → clarifying → draft → reviewed → approved → exported`. Missing required facts and unresolved requirements prevent review/approval. Draft edits invalidate review and approval. Independent review examines accumulated requirements, exclusions, evidence, complete Markdown and commercial calculations; failure never grants approval. Human approval comes only from the authenticated QA action, never from an agent tool argument or quoted conversation text. Export verifies the exact draft hash again and fails on concurrent modification.

Workflow state is Host-owned, persisted outside the model-writable workspace and scoped by canonical cwd and session id. The Markdown artifacts stay in the session workspace for reading and downloading. A different session cannot open or approve the workflow merely by knowing its id. Server state survives restart; writes are atomic and updates use revision checks.

Review preserves original human messages behind active compaction checkpoints; model-written summaries are not evidence of human decisions. Long review packets are saved in the session workspace with a SHA-256 fingerprint so an expert's task-size limit cannot silently cut off the draft. The reviewer must read the complete packet in bounded windows. Prose and Markdown use real lines for paging. A changed packet, inaccessible material or an unresolved review issue cannot produce approval; a positive review summary does not override a `revise` verdict. Successful checks belong in the summary, while findings and follow-ups describe blocking corrections.

The update tool publishes the nested data schema: facts and requirements are arrays, evidence records identify their sources, and commercial lines declare quantities, prices and provenance. Specifications and unpriced proposals omit commercial data; an unpriced proposal records the pricing decision as a confirmed fact.

## Tools and sibling API

- `document_workflow_start`: register proposal/specification intent, product version and template; discover required fields and template content.
- `document_workflow_update`: save facts, requirement coverage, constraints, unresolved items and verified commercial inputs.
- `document_workflow_draft`: save a complete Markdown revision after checking the configured required fields and coverage rules.
- `document_workflow_read`: recover current state, requirements and latest Markdown after an interruption.
- `document_workflow_review`: run an independent domain reviewer with the full material, record PASS only for the unchanged hash.
- `document_workflow_export`: render only the reviewed and human-approved revision; report complete artifact paths.
- `document_calculate`: exact decimal line and total calculations from explicit quantities/unit prices; no price discovery or inferred tax rules.

The documents Host face exposes status and approval to QA after QA authenticates the account and session. It exposes no model-facing approval tool. The UI adds a compact approval action beside the Markdown draft and otherwise uses the existing conversation and files panel.

## Templates and completeness

The template registry distinguishes Markdown content from reference DOCX styles. A template may declare required fact keys and section headings. Missing inputs yield specific clarification blockers; no cross-version substitute is selected silently. Explicit screenshot insertion notes are supported. Drafts may show TODOs, but finalisation rejects unresolved required facts, requirements, placeholders and TODOs. Commercial totals are recomputed by code and compared with the data reviewed and approved.

## Verification

Tests must cover proposal and specification, missing required data, forbidden-module coverage, incomplete evidence, exact decimal calculations, failed review, user approval, stale approval, restart, concurrent edits/export, file mutation, cross-session access and valid Markdown/DOCX artifacts. Browser acceptance uses fresh ordinary QA chats; existing user data and external systems are not modified.
