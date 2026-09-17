---
"@yadsh/dsh-openviking-memory": patch
---

Reject an empty `grep` pattern or `search`/`find` query as invalid parameters instead of forwarding it to the OpenViking server.

The upstream server answers a retrieval call whose free-text parameter carries no non-whitespace character with a plain "no matches" result. That reads as a real, negative answer, so a model that sent an empty argument once kept resending it — one audited QA-stand session logged seventeen byte-identical empty `grep` calls in a row, each answered the same way. The stdio proxy now answers such calls itself with a JSON-RPC invalid-params error naming the parameter, and rewrites the upstream `tools/list` schemas so `grep.pattern`, `search.query` and `find.query` are advertised as required with a minimum length — the contract is visible before the model's first call, and `grep`'s list form of `pattern` gets `minItems` instead. `grep` keeps accepting either a single pattern or a list; only the all-empty shapes are refused.

Both checks ride on two new proxy-core seams (`requestGuard`, `adjustUpstreamTool`) supplied by the harness entrypoint, so the vendored core stays free of OpenViking tool knowledge; see UPSTREAM.md.
