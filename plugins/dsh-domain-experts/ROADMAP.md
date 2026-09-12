# Roadmap

Public intentions only. v1 is the scope in [SPEC.md](./SPEC.md) §4.

## Next

- Durable, queryable execution audit (runs by domain, cross-domain
  delegations, worker usage, latency, failed scope checks).
- Native structured output via the runtime's `outputSchema`, keeping the lenient
  parser as the fallback.
- Per-provider configuration UI contributed by the provider itself, replacing
  the opaque JSON map for third-party adapters.
- Domain import/export as a documented YAML/JSON document, so a domain catalog
  can be reviewed and versioned outside the running host.

## Later

- Automatic domain routing (`domain_route`) as a separate surface that suggests
  or selects a domain, never replacing explicit execution.
- Domain hierarchy (`parent`) with inheritance for shared docs, memory and tool
  policy, while children keep their own private memory.
- Domain templates and expert quality metrics.
- Domain-aware retrieval ranking once a retrieval backend is pluggable.

## Explicitly not planned

- Making `toolFilter` a security sandbox. Domain scoping separates visibility
  from authorization; real isolation needs OS-level sandboxing, which this
  plugin does not claim to provide.
- Inferring organizational ownership from source code.
- One installed Cordis plugin or agent preset per domain.
