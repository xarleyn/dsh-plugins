---
"@yadsh/dsh-qa-surface": patch
---

An attachment the deployment refuses is answered as the caller's 415, not a 503.

The integration API shipped in 0.11.0 with the rule that a file the Host cannot
read refuses the whole question with `415` — the bridge's own fallback signal,
which makes it repeat the question without attachments instead of publishing an
answer whose material never reached the model. One class of refusal escaped that
rule: the last ones happen in the Harness, past this plugin's reach, and the
session controller folds every one of them — an image over the Host's byte,
pixel or dimension budget, bytes that are not the type the caller declared, and
an image at all on a model route that cannot see one — into a single Remote
failure, `session/attachment-invalid`. The service knew only its own refusal
vocabulary, so those fell through to its catch-all and became `503 unavailable`.

The consequence was not cosmetic. A `5xx` is what the bridge retries, so a ticket
whose screenshot the deployment's model cannot see was retried forever, and the
question never got an answer. A deployment whose model route declares no image
input — which is the common shape for a self-hosted text model — hit this with
every attachment of that kind.

The Harness's refusal is now read structurally and mapped onto the same `415`,
with its reason code (`MODEL_DOES_NOT_SUPPORT_IMAGES`, `IMAGE_TOO_LARGE`,
`IMAGE_TYPE_MISMATCH`, …) in the response body and in the Host log under
`integration.attachment-refused`. A refusal this plugin raises itself keeps using
that same log event, so one line covers both halves. A failure that is not the
caller's to correct — a session that cannot be opened, a model that refuses the
turn — stays `503`, because that one is worth retrying.

Two smaller losses in the same path are fixed with it. A Host whose temporary
directory cannot be created for a document extraction now answers the caller's
`415` with the reason in the log rather than an opaque `503`. And the multipart
reader reads the RFC 5987 `filename*` parameter, where a non-ASCII file name
arrives: without it the part had no plain `filename`, so it was read as a text
field and the attachment silently vanished from a question that was then
answered without it. A part with no header separator is refused as
`invalid-request` instead of being skipped, for the same reason.
