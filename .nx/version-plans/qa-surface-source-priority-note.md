---
"@yadsh/dsh-qa-surface": minor
---

The QA prompt gains a note saying which source owns the question.

`notes` carried three ambient notes — who the user is, the rules about source
provenance, how to label delegations — and none of them said where an answer
belongs. The memory plugin's skill says so for the model that reads it, but a QA
persona registers with `complete: true`, the persona is the whole system prompt,
and a skill is read only once the model decides to reach for it; on a stand
where the model went to memory instead, nothing told it otherwise.

The new `notes.sourcePriority` note is the deployment's version of that rule,
and a new editable surface beside the three the `notes` block already had:
read what the conversation and its attachments already carry, then the product
documentation and the domain expert, and only then memory — with the two
consequences the failure needed spelled out, that a miss in memory is not
evidence that no source exists, and that memory is not where a document, a page
or a product fact is looked up. It is on by default beside the other notes, can
be muted or reworded on its own from the «Заметки модели» section of the
settings card, and reaches attested chats and their delegated children only, on
the same gate as the provenance and delegation notes. A stand with no memory
plugin keeps it harmlessly: the note names sources the model does not have.
