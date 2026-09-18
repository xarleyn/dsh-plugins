---
name: contract-review
description: >
  Review two revisions of a contract, specification, policy or instruction, and report what
  changed and what it means. Use it whenever the user hands over two versions of a document
  ("our version", "the customer's redaction", "сравни редакции", "что изменилось", "покажи
  риски"), asks what a redaction changed, or wants the risks in a new revision. The comparison
  itself is deterministic: this skill never discovers differences by reading the documents — it
  interprets differences that document_compare already proved.
allowed-tools: document_inspect document_compare document_diff_read
version: 2026-09-18
---

# Contract review

A contract review has two halves, and they must not be mixed. **What changed** is a fact, and
it comes from `document_compare` — computed by the plugin, not by you. **What it means** is
interpretation, and that is your job. The whole point of the split is that a conclusion can be
traced back to a fact, so a reviewer can check the reasoning instead of trusting it.

## The one rule

Semantic analysis MUST be based on `document_compare` / `document_diff_read` results. Do not
independently discover differences between the source documents.

If you do not have a `changeId`, you do not have a difference. Never report one, never
paraphrase one from memory, and never "double-check" the comparison by reading both documents
yourself — the tools are the only source of what changed, and a claim without a `changeId` is
indistinguishable from a hallucination.

## Workflow

1. **Inspect** both documents with `document_inspect`: what they are, how big, how structured.
2. **Compare** them with `document_compare`. Use `mode: "contract"` unless the user asks
   otherwise: it includes headers, footers and footnotes, folds whitespace and formatting, and
   keeps everything that carries meaning — numbers, percentages, currencies, dates, negations.
3. **Check the quality** the result reports. `high` is a native DOCX pair; `medium` means a
   text-layer PDF; `low` means OCR, a cross-format pair, or a mixed extraction. On `low`, say
   so before your conclusions: wording may be approximate, and a "change" may be a recognition
   difference. Never hide this from the user.
4. **Read every change** with `document_diff_read`, paging with `nextCursor`. Do not stop after
   the first page, and do not assume the preview in the tool result is the whole set.
5. **Group** related changes: one clause edited in three places is one finding, not three.
6. **Explain** each group: what the text now says, compared to what it said.
7. **Assess** the consequence for the user's side. That is interpretation, and it is welcome —
   as long as it stands on the cited changes.
8. **Cite** a `changeId` for every conclusion.
9. **Say nothing about a difference you were not given.** If the comparison found no change in
   a section, that is not evidence that the section is fine; it is evidence that the text is
   the same.

## Signals are facts, not verdicts

Each change carries signals the plugin computed from the text. They tell you where to look;
they do not tell you what matters.

| Signal | What it means |
| --- | --- |
| `MONEY_CHANGED`, `NUMBER_CHANGED`, `PERCENTAGE_CHANGED` | an amount, a count or a rate moved |
| `DATE_CHANGED`, `DURATION_CHANGED` | a date or a period moved — the most common commercial edit |
| `NEGATION_CHANGED` | a `не` appeared or disappeared: read the sentence twice |
| `OBLIGATION_TERM_CHANGED` | `обязан` / `shall` / `must` vocabulary changed |
| `PERMISSION_TERM_CHANGED` | `вправе` / `may` vocabulary changed |
| `PROHIBITION_TERM_CHANGED` | `не вправе`, `запрещается`, `shall not` vocabulary changed |
| `LIABILITY_TERM_CHANGED` | liability, penalty, damages or indemnity vocabulary changed |
| `PARTY_REFERENCE_CHANGED` | the party the clause is about changed |
| `URL_CHANGED`, `EMAIL_CHANGED` | a reference moved |
| `FORMATTING_CHANGED` | same text, different formatting (only when formatting is compared) |

An obligation turning into a permission (`обязан` → `вправе`) is one word and one signal, and it
is usually the most consequential edit on the page. Filter for it: `document_diff_read` accepts
`signals: ["obligation"]` and other family names.

## Report shape

Answer in the user's language. For each finding:

```markdown
### 1. Срок оплаты — chg_a831d23f

**Было:** Оплата производится в течение 10 рабочих дней.
**Стало:** Оплата производится в течение 30 календарных дней.

**Смысл:** срок оплаты увеличен втрое, и отсчёт ведётся в календарных днях.

**Потенциальный риск:** увеличивается период до наступления обязанности по оплате;
проверьте влияние на денежный поток и согласованность с разделом 5.1.
```

Close with the count of substantive changes, the sections they fall into, and the `changeId`
of each. If the change set is large, group by section and lead with the signals that matter for
this contract.

## What a tool-restricted deployment means

If `document_to_markdown` or a shell is missing from your tool set, that is deliberate. The
comparison runs inside the plugin, and the workflow above needs only three tools. Do not look
for another way to read or diff the documents, and do not ask for one: if the deterministic
pipeline refuses a pair — an encrypted document, a macro-enabled one, a format it does not
support — report the refusal and its code instead of comparing what you can.
