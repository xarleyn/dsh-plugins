---
"@yadsh/dsh-qa-surface": minor
---

A question can be asked over HTTP, with an integration token instead of a browser.

The surface could only be used by a person in a browser: the account credential
is an HMAC token minted at login, every action is a DSH remote call from the
client bundle, and there was no long-lived credential and no HTTP endpoint for
another application at all. A ticket system integration therefore had nowhere to
send its questions.

The deployment can now serve `POST {integration.basePath}/ask`,
`GET {integration.basePath}/session` and `GET {integration.basePath}/health`
(off by default, `/qa/api` when switched on).
`/ask` takes the same request the bridge already sends — `application/json`, or
`multipart/form-data` with the ticket's attachments: an image rides the prompt
inline, a text file is decoded, and a PDF or Office document is extracted to
Markdown through the deployment's own document pipeline, so the question is
answered with the attachment in hand. A file the Host cannot read refuses the
request with `415`, which is the fallback the bridge implements — it repeats the
question without attachments rather than receiving an answer nobody could base
on the material. Nothing is stored: the bytes live in a temporary directory for
one extraction, and the inlined text is bounded. It answers with
`chat_id`, a Markdown `answer`, `sources`, `confidence`, `escalate` and `reason`,
within a configurable budget (90 seconds by default, and `maxAnswerCharacters`
for the answer the ticket comment can hold — an over-long answer is cut at a
paragraph break and marked, not silently truncated by the ticket system).
Passing the returned `chat_id` back as `session_id` continues the same
conversation.

The account issues that credential itself, in a «Интеграционные токены» section
of the `Настройки` dialog: it lists its own tokens with their scopes, expiry and
last use, mints one (the secret is shown once and is never recoverable), and
revokes one with a confirming click. Minting is offered only while the endpoint
is switched on, while revoking keeps working either way, and the token always
belongs to the account that asked — one account never sees another's tokens.

Requests authenticate with an integration token, a second credential that is
deliberately not the browser token: it survives a password change, it carries
scopes, it expires on its own schedule, it is stored only as a SHA-256 digest,
and it is revoked on its own (`qa-accounts token create|list|revoke`) without
touching anybody's browser session. An account that is disabled, and the
operator's `revoke <email>` leak response, do stop it.

The conversation can be read back too: `GET {basePath}/session?chat_id=…`
returns the prompts and answers of a chat the token's account owns, in the same
words the answer carries them, page by page from a cursor the caller keeps
(`after`, `limit` up to 200, `truncated` when older messages stayed below the
window). This is what the `sessions:read` scope is for — a bridge whose question
was escalated can show the specialist what was already said instead of spending
a turn to ask it again, and a read-only integration can be granted that scope
without the right to spend inference. Injected context, reasoning and tool
traffic are never published: they are model input the caller did not write.
Ownership is the rule `ask` already applies, so an unknown chat id and another
account's chat answer one `404`. Reading stays cheap on a long conversation: the
newest messages are kept warm and a chat this Host holds is checked against its
own memory, so a page costs neither a stored read nor a walk through the history
behind it — a page of a ten-thousand-message chat is a page.

The endpoints run questions through the same admission path as the browser —
deployment preflight, the per-user workspace, the capability snapshot, the QA
tool policy and the attestation record — so an external caller cannot reach a
chat composition a person could not open, and it can only ever continue chats
owned by the account its token belongs to.
