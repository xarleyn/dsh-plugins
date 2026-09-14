---
"@yadsh/dsh-qa-surface": minor
---

Show an optimistic user bubble immediately after Send, including local image
previews and file handles, while session creation, policy admission and the
Host's pre-loop preparation are still pending. The bubble carries an animated
«Подготавливаю ответ…» status, reconciles with the durable user message without
duplication, and disappears on a refused send while the composer keeps its
draft.
