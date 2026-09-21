---
"@yadsh/dsh-openviking-memory": minor
---

Memory is kept per QA account, and each account can switch automatic context
off for itself.

One plugin serves every chat on a deployment, so until now every account read
from and wrote into the same OpenViking space: recall handed one user another
user's memories, and capture filed one user's conversation where the next user's
recall would find it. With a QA surface mounted the plugin now asks it who owns
the session (`principalForSession`) and sends that account as
`X-OpenViking-User`; a delegated child inherits the chat that created it, and a
session no account has claimed yet is left entirely alone — it issues no request
at all until its browser half claims it. Deployments without a QA surface keep
the single deployment-wide identity, and `qaUserScoping: false` restores it
explicitly.

The settings card now actually appears. It never did, anywhere: a card is
rendered only for a namespace the live plugin registered in the Host's settings
directory, and this plugin only declared its schema — `static Config` publishes
nothing. The host half now installs its section (the same shape the first-party
cards use), which makes the namespace discoverable in a local installation, and
adopts the section as its configuration source: a committed change is
re-resolved and handed to the running runtime, so a switch reaches sessions that
are already open, while the bridged MCP tools follow on the next reload.

The switches a user owns moved to where that user can reach them. The Host's
"Plugin configuration" card is discovered from the settings directory, which a
browser reaching a deployment over the network never gets — and a QA overlay
does not render the native settings tree at all — so on a QA deployment the card
was unreachable for everybody even once it registered. The plugin now also registers a page in the
signed-in user's QA settings dialog ("Память"), backed by three Remote methods
that authenticate the caller by token and store the answer per account in
`openviking-memory-qa-users.json` under `$DSH_HOME`. The page narrows the
deployment's plan and can never widen it: `autoInject` off silences the profile
and the recall for that account, capture and the memory tools keep working, and
one reset hands every knob back to the deployment.
