---
"@yadsh/dsh-answer-review-gate": patch
---

Independent verification reaches the domain-experts backend again.

The gate resolved its reviewer service as `ctx.get("domain-experts")` — which
is the plugin id and the settings namespace, but not the service name: the
provider registers `ctx.domainExperts`, and its own wiring test pins that key.
The lookup therefore returned nothing on every deployment, so every answer
came back with the failure-policy notice — "independent verification could not
be completed (the dsh-domain-experts service is not loaded)" — while the
plugin ran in the same process, and the reviewer never ran. The gate now asks
for the key the provider publishes, and a regression test pins the contract in
both directions: a service registered as `domainExperts` is used, and the
plugin-id spelling is not silently accepted as a reviewer backend.
