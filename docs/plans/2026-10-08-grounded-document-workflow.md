# Grounded proposal and specification workflow

Status: implemented and verified on an authorized local deployment. Baseline: `ccb2eaa3643ba9b5d671acf9226788c1dfe0fd07`.

## Required outcome

The existing QA agent prepares customer-specific proposals and specifications from uploaded requirements, confirmed product capabilities and an approved template. It asks for missing required information, honours excluded modules and minimal/extended scope choices, saves Markdown, reviews complete drafts, applies user revisions and exports the explicitly approved revision as a complete DOCX. Screenshots may be explicit insertion notes. Commercial calculations use verified catalogue entries and deterministic arithmetic. External systems remain read-only.

## Implementation decisions

- Keep the existing agent runtime and QA surface. Extend document services and use small review/approval actions rather than a separate editor.
- Persist requirements, evidence, blockers and approval in Host-owned storage outside the writable workspace; keep Markdown draft revisions in the calling session workspace. Review and user approval apply to a content hash; edits invalidate both.
- Templates are registered names with separate Markdown content and reference DOCX styles. Missing authoritative material is a blocker, never an invitation to invent product claims or prices.
- Finalisation enforces the workflow on the Host. General conversion tools remain general-purpose.
- Download complete files through bounded authenticated chunks, independent of preview limits.
- Review receives accumulated requirements, scope decisions, complete draft, evidence and primary capabilities. Reviewer failures cannot approve a final document.

## Work and acceptance

1. File transport and document comparison: complete download, mutation/ownership checks, lossless warning metadata, formatting spans. Regression tests and package checks.
2. Document workflow: persisted intake/clarification/draft/revision/review/approval/export, deterministic calculations and template content contract. Test restart, stale approval, parallel edits, review failure, exclusion and unresolved fields.
3. QA integration: full-file downloads and compact draft approval in the existing conversation; no complex editor. Update curated changelog and Nx version plans.
4. Deployment materials: align source/runtime attachment policy, template registry and proposal/specification skills, avoid duplicate answer reviews; preserve existing data and secrets.
5. Verification: affected package checks, package/tarball verification, real converter roundtrip, fresh-chat browser/agent acceptance of proposal and specification, revision, refusal and isolation paths.

## Limits and scope

Automatic screenshot acquisition, external task creation and a separate contract-risk/gap-analysis product are future scenarios in the supplied meeting notes. Existing document comparison defects are repaired because revisions rely on that functionality. Do not guess commercial data or silently replace the product version required by the provided skill.

## Current state

The workflow, transport, comparison fixes and QA approval action are implemented. Package checks cover documents, answer review, domain experts and QA, including lint, types, tests, builds and package verification. Text-only fallback extraction no longer advertises OCR and refuses forced recognition. Fresh proposal and specification chats passed clarification, user revision, independent review, revision-specific owner approval, real DOCX export and browser download. Approved revisions and identical exported bytes survived a service restart. Native PDF preview and a separate deterministic converter smoke also passed; an approved PDF workflow export and a live priced proposal remain outside this browser acceptance pass.

Native preset discovery and grants use the calling agent's scope while preserving role ceilings. Skill-reference failures report the correct absolute resource path. Long review packets retain the full draft, primary capabilities and actual human decisions, including question answers recovered after compaction. Required expert reviews finish through validated native structured output; prose cannot substitute for that capture. QA permits only the designated child-owned capture tool without widening the primary tool ceiling.

The authorized deployment carries the verified packed builds. Detailed runtime evidence remains private. The whole-day deployment smoke still reports historical failures and tool verification warnings, so successful current acceptance does not establish general deployment health. Corporate Word styling and production pricing data were not supplied for final-layout or priced-case validation. This work has not been pushed or released.
