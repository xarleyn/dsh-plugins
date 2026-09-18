---
"@yadsh/dsh-qa-browser": patch
---

Say why a host was blocked, and what lifts the block.

`Private-network destinations are blocked by Browser policy.` was the whole answer a model and an operator got for a corporate hostname the deployment's DNS resolves into an internal range — which is the ordinary shape of an intranet Jira or wiki, not an attack. The refusal now names the host, the class of the address it resolved to (RFC1918, carrier-grade NAT, IPv6 unique-local) and the setting that allows it: `security.network.allowHosts` for one host, `security.network.allowPrivateNetworks` for the deployment. The loopback and link-local refusals carry the same detail. No address is disclosed in the message: the class is what a fix depends on.
