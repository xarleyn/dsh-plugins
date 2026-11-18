# Roadmap

Public intentions only. v1 is the scope in [SPEC.md](./SPEC.md) §4.

## Implemented

Foreground expert calls can request native structured review output.
Commit `03ee40e2` added the child schema and required capture. The
[execution tests](./tests/execution.test.ts) cover captured output and refusal
of a prose-only verdict. Qualifying each model provider remains a separate
runtime check.

The Host operator can [transfer a catalog](./README.md#import-and-export-a-catalog)
using versioned JSON with a preview of conflicts and atomic apply.

Scope providers can [contribute configuration fields](./README.md#edit-provider-scope-settings)
to the Resources tab. The Host preserves opaque configuration when applying form edits.

## Next

- Durable, queryable execution audit (runs by domain, cross-domain
  delegations, worker usage, latency, failed scope checks).

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
