---
"@yadsh/dsh-web-fetch-authenticated": patch
---

An IPv4 address written inside IPv6 no longer slips past the network classification.

`::ffff:7f00:1` is 127.0.0.1 — the same host in the other syntax, and the address both Node and the browser's URL parser connect to. The IPv6 branch of the classifier read its top bits instead, found no IPv4 range there, and called it `public`. A rule that denied loopback, the RFC1918 ranges, link-local and the cloud metadata endpoint `169.254.169.254` accepted every one of them as soon as the URL, or a DNS answer, used the mapped spelling. The dotted spelling `::ffff:127.0.0.1` did not parse at all, which made every IPv6 literal ending in a dotted quad unparseable.

An address is now judged by the bytes a connection reaches. A mapped literal collapses into its IPv4 before classification, takes the IPv4 class and the IPv4 verdict, and the socket is pinned to that IPv4 text instead of to a second spelling of it, so the address the policy approved and the address it judged cannot differ. A denied CIDR matches either byte form of the host and an allowed CIDR matches only the destination it names, so a rule that already blocked `::ffff:0:0/96` keeps blocking it. The deprecated IPv4-compatible block (`::x.y.z.w`) and the NAT64 well-known prefix (`64:ff9b::/96`) reach their embedded address only through a translation router this plugin cannot verify, so both fail closed as `reserved` and no allow-flag opens them, while `::`, `::1` and genuine IPv6 addresses keep their own classes.

What this does not claim: it is a classification bypass, not a demonstrated open proxy. No request reached these addresses while the bypass was being measured, and reaching them still needs a rule whose host, port and path patterns accept the URL.
