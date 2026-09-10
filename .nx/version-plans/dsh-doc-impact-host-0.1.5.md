---
"@yadsh/dsh-doc-impact": minor
---

Port to the DSH session format v3: the tool context now derives from the
host ToolRunContext and reads the raw log via session.snapshotEvents()
instead of the removed session.events. The supported host range moves to
>=0.1.5-rc.2 <0.2.0, dropping 0.1.1-rc.2.
