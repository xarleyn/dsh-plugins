---
"@yadsh/dsh-qa-integrations": minor
---

Extend the Bitrix24 integration from four tools to a read-only catalog of 27,
covering CRM context, employees and departments, chats and open lines, tasks,
calendar and Drive. Each tool is one catalog operation with a validated,
read-only argument set: CRM schema and funnels, stages and status dictionaries,
activities with deadlines, timeline comments, stage history, product rows and
duplicate lookup by phone or e-mail; employee search by name, e-mail or
department; chat search, recent dialogs, message search inside a chat and
open-line dialog history; task search and single task cards; calendar events and
free/busy lookup; Drive full-text file search.

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
