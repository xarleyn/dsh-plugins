---
"@yadsh/dsh-draft-sessions": patch
---

Drafts now hold their Session the way the Host expects a feature to own one.

Opening a draft used to hand the Host a navigation request and then trust that
the Session behind the draft was ready. The Host no longer navigates on behalf
of a feature: a Session counts as open while the feature that asked for it keeps
holding it, and it is torn down once nothing holds it. The composer therefore
takes that hold when it starts mirroring a draft and gives it up when the draft
is closed, replaced by another, or deleted. Reopening also waits for the
Session's first history attempt to settle before the saved text is put into the
composer, so the text no longer lands in a scope that is still arriving; when
the Session never becomes usable, the composer still reports the draft as having
no client scope, and now releases the hold it took before saying so.

Which Workspace a new draft lands in is read from the same hold: the Session of
the draft being composed first, and the most recently active Workspace
otherwise. Deleting the draft currently on screen no longer asks the Host to
clear a selection — releasing the hold is what makes that Session not current
any more.
