---
name: grounded-documents
description: >
  Prepare and revise customer-specific proposals (ТКП) and specifications (ТЗ)
  from requirements, verified product capabilities and registered templates;
  ask for missing facts, save Markdown, review and export the approved revision.
allowed-tools: document_workflow_start document_workflow_read document_workflow_update document_workflow_draft document_workflow_review document_workflow_export document_calculate document_inspect document_to_markdown document_compare document_diff_read
metadata:
  qa-surface:
    version: 1
    audience:
      type: common
    tools:
      requires:
        - document_workflow_start
        - document_workflow_read
        - document_workflow_update
        - document_workflow_draft
        - document_workflow_review
        - document_workflow_export
        - ask_user_question
      grant:
        requireAll: true
        lifecycle: session
---

# Grounded proposals and specifications

Use the existing agent and conversation. The product-specific skill and sources
own the domain facts; this skill owns the document lifecycle. Use registered
template names `proposal` and `specification` unless the deployment declares
different names. A missing content template is a configuration blocker, never a
reason to invent a layout or use another product version silently.

1. **Intake.** Read the supplied requirements and attachments first. Use
   `document_inspect` and `document_to_markdown` for DOCX/PDF. Discover the
   correct product version and content template, then call
   `document_workflow_start`. Ask what documents/data the customer has if none
   have been supplied. Preserve their request, not just a convenient summary.
2. **Accumulate facts and coverage.** Retrieve product documentation and
   applicable corporate sources. A customer request does not prove a supported
   capability. Map every requirement to full/partial/none/unclear coverage and
   explicit versioned evidence. Honour excluded modules. Include supporting
   functionality actually needed for the requested capability; ask whether to
   offer a minimal or extended scope when the choice matters. Save facts,
   requirements, constraints and remaining questions with
   `document_workflow_update`. Each update contains the complete accumulated
   ledger, not just the last answer. Recover it with `document_workflow_read`
   after an interruption.
   Copy the current revision from the last successful operation exactly; the
   service increments it. Never increment the argument yourself. Use an empty
   unresolved list when all blocking questions are resolved or explicitly
   accepted as documented limitations. Keep accepted limitations in the facts
   and requirement decisions rather than as remaining blocking questions.
3. **Clarify.** Retrieve available answers before asking. Use
   `ask_user_question` for missing required customer facts and business
   decisions. Group a few important questions per round; do not re-ask facts
   already confirmed. A partial/unsupported requirement needs an explicit
   human limitation/scope decision. Never present it as fully supported.
4. **Commercial inputs.** Record the customer's explicit `pricingDecision` fact
   with value exactly `priced` or `unpriced`; put the customer's words in
   `evidence.quote`. For a priced proposal retrieve an approved current
   price source and confirmed quantities. Historical proposals are not a price
   list. Record confirmed tax, payment and delivery decisions as a sourced
   `commercialTerms` fact. Ask if prices, tax treatment, terms or delivery decisions are missing;
   keep them in `unresolved`. Use `document_calculate` or the workflow's
   commercial lines for exact decimal calculations. Quote those outputs
   exactly. Tax treatment is a source-backed business input; no tax rule is
   inferred by the calculation tool. If the customer explicitly requests an
   unpriced draft, record that decision and label the document accordingly.
5. **Draft Markdown.** Read the registered template content. Populate the
   necessary customer-specific sections and remove inapplicable boilerplate.
   Save the full Markdown using `document_workflow_draft`. Explain remaining
   blockers and offer the draft in the chat. Ordinary drafts may contain
   explicit TODOs; final review/export may not. A screenshot may be a plain
   insertion note such as `[Место для скриншота: диаграмма мониторинга]`.
   Never invent an image. Required system requirements/appendices remain
   separately identified when the domain template requires it.
6. **Independent review.** Call `document_workflow_review` with the current
   revision. It checks the full draft, accumulated evidence, source human
   messages and constraints. Fix every confirmed issue; report unavailable
   evidence. A failure or REVISE never permits finalisation. This subject
   review is separate from the general answer-review gate.
7. **Human revision and consent.** Show the reviewed draft. Apply comments,
   customer scope changes or changes in an uploaded document, using
   `document_compare`/`document_diff_read` for file revisions. Save and review
   the new revision. Send the complete new text to `document_workflow_draft`;
   never edit or overwrite its saved file directly because its hash is recorded.
   Ask the user to use the approval action beside the saved
   Markdown when satisfied. Approval belongs to the exact reviewed revision;
   an older approval, your own inference from a phrase, or an approval of a
   tool permission cannot grant it.
8. **Export.** Markdown is already a usable saved result. When the user requests
   DOCX, use `document_workflow_export` for the current approved revision.
   Never bypass a refused finalisation with `document_create` or
   `document_convert`. Report the generated file; QA presents it as a
   downloadable attachment. Do not claim that an unreviewed, incomplete or
   unapproved document is final.

External trackers and corporate systems remain read-only. Creating tasks,
automatic screenshot capture and separate contract-risk/gap-analysis products
are outside this generation workflow.
