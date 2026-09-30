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
permission plus an explicit opt-in now delivers the notice, and the click asks the
browser nothing — `requestNotificationPermission` short-circuits on an answered
origin, which is what the test pins by counting the asks.

The two answers now keep separate records. `osOffered` marks that this page has
stopped asking this browser — the question being either answered or waved off while
it was still open — so it gates only the branch that still has one to ask; where the
origin is granted, the action stands or falls on the reader's answer alone. That is
what keeps the line's own cross from being read as a refusal of the channel: it
clears the stack, and the action returns with the next notice instead of taking this
stand's only way in away for good. A click that asked the browser nothing leaves the
mark untouched.

Both branches stand on the reader's answer, read from `channels.desktop`: the
account's once there is one, this browser's otherwise — the same record delivery is
decided by. Where it says the channel is on there is nothing left for this page to
offer, the browser having answered or not, and an action labelled «Включить
системные уведомления» must not be the way to switch that channel off: a refused
prompt used to write `desktop: false` onto an account that already said yes. The
state an address-bar revoke leaves behind is the other case this rule closes, and it
is a pause rather than a dead end: the record still says the channel is on, so the
next turn that settles while the tab is away goes to the desktop as soon as the
reader allows the origin again — the missing half is the browser's answer, and it is
given in the address bar, not on the line. A cross waved while the browser is still
deciding and the prompt's late answer settle into one record, which a scenario that
holds the prompt open measures.

A signed-in reader keeps the settings section as the place where the channel is
decided: while the account says it is off and the browser still owes its answer the
line asks the browser, and that answer is recorded on the account along with the
channel; where the account already says the channel is on, or the origin has
answered granted, the line offers no switch and writes nothing on its own, the
section asking the browser for the missing half instead. A denied browser, a page
without the notification API and a stand that closed the desktop with
`notifications.allowOs` get the line and no action.
