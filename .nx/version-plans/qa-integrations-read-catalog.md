---
"@yadsh/dsh-qa-integrations": minor
---

Extend the Bitrix24 integration from four tools to a read-only catalog of 39,
covering CRM context, employees and departments, chats and open lines, tasks,
calendar and Drive. Each tool is one catalog operation with a validated,
read-only argument set: CRM schema and funnels, stages and status dictionaries,
activities with deadlines, timeline comments, stage history, product rows,
duplicate lookup by phone or e-mail, requisites and AI call transcriptions;
employee search by name, e-mail or department and the readable employee field
list; chat search, recent dialogs, message search inside a chat, the chat
attached to a CRM entity, task or calendar event, its participants and their
profiles, and open-line dialog history; task search, single task cards, task
change history, results and logged time; calendar events and free/busy lookup;
and Drive full-text search, file metadata, storages and folder contents.

Replace the two capabilities with one per Bitrix24 webhook scope — `crm.read`,
`chat.read`, `openlines.read`, `user.read`, `department.read`, `tasks.read`,
`calendar.read`, `disk.read` — and read the scopes the connected webhook was
actually granted (`scope` method) on connect and on every connection test. The
Settings card therefore lists a capability as available only when both the
deployment switch and the portal agree, and a scope granted later in Bitrix24
appears as a detected but disabled capability that the user enables themselves.
Owner-scoped reads default to the connected Bitrix24 user, resolved server-side
from the stored integration, never from a model argument.

List operations now answer with a uniform `{ items, pagination }` envelope, so
the model sees one response shape instead of six, and id-keyed responses such as
open-line history are projected into ordered arrays.

Three Bitrix24 documentation ambiguities shape the surface: `user.search` is not
called because its parameter table and its examples disagree about where filter
keys belong, while `user.get` with `FILTER.NAME_SEARCH` is documented in one
shape; tasks use the classic methods because REST 3.0 moved to `/rest/api` and
filters tasks by id only, which cannot express "my open tasks"; and
`imopenlines.session.open` is not exposed because its page never certifies it as
read-only, the same dialog lookup being a documented get on
`imopenlines.dialog.get`.
