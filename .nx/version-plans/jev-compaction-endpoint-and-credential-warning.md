---
"@yadsh/dsh-jev-compaction": patch
---

A self-hosted backend is reached again, and an unset key is reported at startup.

`decision.<provider>` — the shape the README documents and the profiles use —
was shadowed by the legacy flat `jev` block. The settings service hands the
resolver a configuration with every shipped default filled in, so that block
was always present, and `resolveEndpoint` let it win over the provider: a
deployment configured for a local System One server on `decision.jeff.*` asked
for `TYPESAFE_API_KEY` and refused every prune with "is not configured" before
a single request left the host, while the local scorer sat idle. The legacy
block is now an override only for values that differ from the shipped defaults,
so it still serves deployments that wrote it and stops shadowing the provider
they selected.

Two smaller things around the same failure: a base URL that names only a host
(`http://jeff:8000`, which is what the preset, the README and a deployment's
own row said) is completed with the `/v1/systemone` route the System One
contract defines — the client POSTs to the configured URL as it stands, so a
bare host used to answer `404 Not Found`; and a backend whose key variable is
empty at startup is reported once in the plugin log
(`jev-compaction/credential-missing`, with the provider, the variable and the
endpoint), because the environment is not part of the configuration and the
first symptom would otherwise be a prune refused minutes later. The refusal
itself now names the backend and the endpoint it tried to reach.
