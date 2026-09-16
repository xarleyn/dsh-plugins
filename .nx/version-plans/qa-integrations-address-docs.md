---
"@yadsh/dsh-qa-integrations": patch
---

Write the operator-configured TeamCity address down where the deployment's
configuration is documented. The "how TeamCity connects" section, the TeamCity
config example and the end-to-end deployment example all show
`teamcity.serverUrl` now, and the walkthrough no longer tells users to type the
server into the connect form — the address is one per stand and comes from the
deployment, while the form asks for the token alone.
