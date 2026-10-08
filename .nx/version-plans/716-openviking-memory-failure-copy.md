---
"@yadsh/dsh-openviking-memory": patch
---

The memory page of the QA settings dialog answers a failed read in the reader's
own words instead of repeating the transport's line.

A deployment that does not let this browser session reach the memory service
answered the «Память» tab with `client api: openvikingMemory/userMemoryOverview
failed: transport failure for /api/openvikingMemory/userMemoryOverview: HTTP 403`.
The page printed whatever the wire carried: an RPC method, an endpoint and a
status code — the inside of the surface, and a sentence nobody can act on,
because `HTTP 403` answers neither "is my memory switched off" nor "is the stand
broken". The store's own socket sentence reached the dialog the same way, from
the overview the plugin reads on the page's behalf.

Now a failure crosses that boundary as a kind, and each kind has its own copy:
a session the deployment does not let through is named as the operator's
allow-list, a store that does not answer is separated from one that refuses this
deployment, an expired sign-in tells the reader to sign in again, and a call the
transport could not complete reads as a stand that says nothing. What a page
cannot classify gets the one generic sentence — never the string it could not
classify. The method, the endpoint, the status and the store's own message are
not thrown away: they go to `console.debug` in the browser and to
`qa_memory_overview_failed` in the plugin log, where an operator greps them. That
is how the rest of the dialog already answers — the QA surface and the
Integrations page both map a failure to authored copy — and the memory tab was
the section that had not.

Nothing about where memory is stored or read changed, and the switches that
decide whether the assistant uses memory at all stay out of this page: it reads
and only reads.
