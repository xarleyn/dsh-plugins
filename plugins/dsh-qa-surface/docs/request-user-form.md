# Durable input forms

`request_user_form` is an opt-in QA catalog tool, independent of `ask_user_question`.
Answer requirements and file requirements are independent. The server validates
its saved schema and every item before creating an immutable submission.

## Enable and authorize

Set `forms.enabled: true` or enable **Пошаговые формы** in Interface settings.
The activation manager publishes the tool only while enabled, in scopes which
already earned QA activation. Existing role and tool allowlists still apply:
grant `request_user_form` explicitly to the intended role. Disabling the feature
removes its catalog entry, ends waits without success and preserves saved data.
A recent owner-scoped `listForms` poll attests an interactive QA client for the
chat. Calls without that client fail immediately. Delegated agents cannot create
or resume forms. Only the chat owner reads and edits form resources.

File forms require QA accounts, the protected upload carrier, Host `fileUploads`
and a host-file-backed `attachments` provider. Text-only forms also support the
account-free QA transport. No live deployment configuration is changed by this
implementation. Ordinary uploads and questions retain their existing behavior.

## Tool contract

```json
{
  "action": "create",
  "request_key": "proposal-intake",
  "form": {
    "schema_version": 1,
    "title": "Исходные данные",
    "steps": [{
      "id": "requirements", "title": "Требования",
      "items": [{
        "id": "task", "title": "Опишите задачу и приложите техническое задание",
        "answer": { "type": "textarea", "required": true, "max_length": 10000 },
        "files": { "requirement": "required", "min_count": 1, "max_count": 3,
          "accept": [".pdf", ".docx"], "max_file_size_bytes": 52428800 }
      }]
    }]
  }
}
```

Resume: `{ "action": "resume", "form_id": "<saved form id>" }`.
The agent supplies no account/session identity, path, receipt or readiness flag.
Repeating a key and schema returns the same form; changed requirements under a
key fail. Choosing a different key cannot bypass an existing draft.

Answers support `text`, `textarea`, `single_select`, `multi_select`. Choice values
are stable identifiers distinct from labels. Recommended options never create
answers. Custom single choice replaces regular selections; a custom multi choice
counts as one selection. Text lengths count Unicode code points. Unknown fields,
duplicate choices and options outside the schema are refused. An optional field
may be empty; nonempty input must satisfy its rules.

File policies are `none`, `required`, `optional`. Non-`none` policies require an
explicit count, extensions and byte limit; `required` additionally requires
`min_count`. `optional` rejects `min_count`, `none` rejects extra file settings.
Agent-provided limits can narrow server policy, never raise it.

## Storage and upload boundary

`qa-forms.db` lives beside the QA accounts database. Mount that directory on
durable storage outside writable agent workspaces. The store uses the existing
plugin-kit SQLite primitive, `BEGIN IMMEDIATE`, WAL and `synchronous=FULL`.
Storage version 1 is distinct from wire version 1. Use **one Host writer** per
database: upload liveness, client presence and waiters are process-local.

Document, revision, snapshot and mutation receipt commit in one transaction.
Identical mutation retry returns its recorded result before checking stale
revision; changed payload under that key fails. Submission retries return the
original snapshot. Waiters are notified after commit. Stop, idle and disposal
detach waits and keep the draft. Restart does not recreate an old tool call.

Intake preserves `QA carrier → /api/qa-chat-upload → fileUploads.uploadStream`.
`formUploadId` names an owner-authorized reservation, and grants no authority by
itself. The route checks access before reading, between chunks and before
binding, and counts actual bytes. Uploads without this parameter retain their
existing response format.

The observed Host receipt is `{ receiptId, file: { attachmentId, name, bytes } }`.
Staged receipts are session-local memory, unsuitable for restart persistence.
The adapter validates the receipt at runtime, reads through
`attachments.readFileStream`, verifies size and SHA-256, validates the format and
saves exact bytes as form-owned SQLite BLOBs. Binding bytes and switching active
versions share the final transaction. Failed replacements leave the old file
active. Cancelled operations and late callbacks cannot resurrect files.
Interrupted operations become failed after reopen; retry or explicit removal is
required. Unresolved uploads block submission even on optional items.

On successful tool completion/resume, saved bytes are re-projected through
`attachments.saveFile`, checked again and resolved by `attachments.fileHostPath`.
The JSON tool result contains the snapshot plus
`resources: [{ resource_id, read_path }]`, addressing exact saved versions in the
Host attachment store. Existing QA read fences and document input grants cover
that root. These paths come from the Host, never the browser. Receipts are never
returned to the model. Owner download uses `readFormAttachment` with fresh access
checks. A Host without a readable local projection fails explicitly.

Admission checks UTF-8 text/CSV, PDF and image framing, and bounded DOCX/XLSX
container structure with expected parts, macro refusal and XML declaration
guards. It does not promise business sufficiency, virus scanning or universal
converter compatibility. No carrier progress callback exists; the UI displays a
stage without a fabricated percentage. Retry transfers the whole file.

## Policy and retention

Defaults: disabled; 20 steps; 100 items; 50 options/item; 128 KiB schema; 10000
code points/answer; 32 KiB total answers; 10 files/item; 50 MiB/file; 250 MiB
active and reserved bytes/form; two concurrent uploads/chat; 900-second intent
lifetime. Extensions: PDF, DOCX, XLSX, CSV, TXT, PNG, JPG, JPEG. All policy fields
are declared in `QaFormPolicy` and exposed as `forms.*` Config. Reverse proxy
request ceilings must permit the configured file size.

Retained versions plus reservations are additionally capped at twice the form
byte limit per chat and per owner across their forms. Replacement reserves old
and new bytes concurrently. Removed/replaced versions and submitted bytes remain
retained. This implementation does no destructive form GC or automatic draft
expiry. SQLite rollback avoids partially bound form objects; Host staging remains
owned by the Host. A retention policy can be added separately without deleting
resources referenced by active bindings or submissions.

## Remote and workflow integration

The existing `qaSurface` namespace exposes `formCapabilities`, `listForms`,
`getForm`, `mutateForm`, `validateFormStep`, `readFormAttachment`. `mutateForm` is
a closed discriminated command for save, begin/cancel upload, remove, pause and
submit. It cannot replace schema, owner, file metadata or submission. Domain
refusals use codes inside `QaFormResult`; Typert adds its outer transport result.
Unexpected errors are redacted.

After restart the user opens and finishes the saved draft. The explicit continue
action sends an ordinary session-controller request telling the main agent to
resume. A saved snapshot alone never starts a hidden model turn.

A trusted proposal-preparation skill must require `status=submitted` and a real
`submission_id`, resume existing drafts, read exact versions from `resources`
and treat pause/Stop/errors as incomplete. The synthetic intake fixture has
three required items and precisely one optional item. Business templates belong
to the deployment's trusted skill, outside the UI engine. This package does not
own that skill or an official proposal issuance endpoint. No global document-tool
restriction or official issuance gate is introduced. A hard issuance guarantee
requires a separate trusted server gate at the actual issuance boundary.

## Acceptance

Tests cover saved state, lifecycle, uploads, access and browser components. An
installed deployment must additionally verify agent → form → required documents
→ replacement → submission → native reader, persistent volume recovery, role
grants, proxy limits and the selected Host version. A local preview is not an
installed-stand acceptance test.
