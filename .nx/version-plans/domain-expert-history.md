---
"@yadsh/dsh-domain-experts": minor
---

A domain expert's run history is visible again, on the domain's own page.

Every run was recorded — the host keeps an audit ring and mirrors each entry to
the plugin log — but no surface ever showed it, so an expert opened from a
conversation through the agents panel left its domain page looking untouched.
The domain editor now has a `Runs` tab. It lists the runs the process still
holds, newest first, one row each: when the run started, its mode and outcome,
the duration, the caller session and the delegation path behind it, and the
child session that ran it. A run started from a chat and one started from the
test screen therefore appear in the same list, which is the equality a domain
page could not show before. `Refresh` re-reads the ring, and a run the page
itself starts lands in the list the moment it finishes.

The memory half was checked and left alone: an expert's notes are read and
written through the same provider and the same `domain/<id>` namespace whichever
entry point started the run, so nothing was hiding memory from the page. The
list is the ring, not a durable log — it is what the running process still
holds, and the tab says so instead of implying a longer memory.
