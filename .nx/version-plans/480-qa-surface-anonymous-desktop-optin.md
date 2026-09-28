---
"@yadsh/dsh-qa-surface": patch
---

The desktop channel can now be switched on by a browser that already allowed the prompt.

Allowing notifications for the stand in one tab used to leave the notice's own
screen with no way in: the «Включить системные уведомления» action was offered
only while the browser's answer for this origin was still `default`, so a browser
that had already granted it — and so had nothing left to be asked — was shown no
action at all. The gate had conflated the browser's answer about its permission
prompt with the reader's answer about the channel.

On a stand without accounts that was a dead end rather than an inconvenience: the
«Уведомления» section belongs to the account and is not reachable anonymously, and
this page's own store is the only record of the desktop choice there. Granted
permission plus an explicit opt-in now delivers the notice, and the click spends
no second prompt — `requestNotificationPermission` short-circuits on an answered
origin, which is what the test pins by counting the asks.

A signed-in reader is left alone with the settings section: the browser's question
is still asked where it is unanswered, and the channel itself is not the notice's
to switch. A denied or unsupported browser gets no action, and a reader who waved
the line off is not asked again — that answer is stored as it was before.
