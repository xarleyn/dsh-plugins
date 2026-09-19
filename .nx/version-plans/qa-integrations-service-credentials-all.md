---
"@yadsh/dsh-qa-integrations": minor
---

Managed service credentials for every provider, not just GitLab and TeamCity.

The deployment-managed shared read-only account existed for two of the seven
integrations: a contractor without a corporate GitLab account, or an intern no
one issued a TeamCity token, could not connect at all. The provider contract
was already generic — the broker resolved the mode and the boundary for anyone
— but only two providers classified their operations, so only two offered the
checkbox.

Bitrix24, Jira, Confluence, Test IT and Weblate now implement the full
provider side: per-operation security classification (effect, sensitivity,
service-safety, resource boundary), capability service states, instance
portal resolution, a probe-only credential health check, and execute-time
enforcement that runs the ceiling first, then the boundary, then the
provider-specific filters. Each provider names its own boundary vocabulary:
`projects` for Jira (project keys), Test IT (project ids) and Weblate (project
slugs), `spaces` (space keys) for Confluence, and `portals` for Bitrix24,
which has no project tree at all — a service webhook must answer on the portal
the profile names, and the profile's secret there is a full incoming-webhook
URL whose host the broker derives itself. The connect cards gained the shared
service UI: the pre-checked "use the service token" box when the deployment
defaults to it, a connect form without a secret field, the mode row with the
switch buttons, and the seven service error explanations.

Sensitive reads stay personal everywhere: CI logs and artifact bodies on
GitLab/TeamCity as before, and now the Bitrix24 people directory, chats,
open lines, call transcripts, calendars and Drive files, the Test IT
attachments (metadata included — a global attachment id cannot be mapped to a
boundary project, so it fails closed), and Jira attachment listings. Catalogs
without a log-like read (Confluence, Weblate) report no sensitive capability.
Everything a provider update adds without an explicit classification stays
denied, as before.
