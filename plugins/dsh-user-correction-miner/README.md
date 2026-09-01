# @yadsh/dsh-user-correction-miner

Server-side DeepSeek Harness plugin that scans persisted and live session logs for explicit user corrections. The current Phase 1 implementation produces provenance-preserving correction evidence; it does not generate, approve, or apply durable rules.

## Design principles

- Corrections are evidence, not durable instructions.
- Every record retains its source session and event sequence.
- Historical reads use `ctx.sessionQuery`; the plugin does not parse persistence backends directly.
- Live observation stays off the model request path.
- Stored text is bounded and redacted by default.
- Plugin failures are contained and never change agent authority.

## Commands

- `/corrections` — show the current workspace summary.
- `/corrections scan` — incrementally scan previous sessions for the current workspace.
- `/corrections scan <N>` — scan at most the newest `N` workspace sessions.
- `/corrections review` — show recent mined evidence. This is debug output, not an approval surface.

## Configuration

```yaml
- id: dsh-user-correction-miner
  config:
    enabled: true
    retention:
      maxRecordsPerWorkspace: 1000
    live:
      maxPendingSessions: 256
      maxPendingEventsPerSession: 32
      pendingTtlMs: 1800000
    analysis:
      maxContextEvents: 20
      maxContextBytes: 32768
    privacy:
      redactSecrets: true
      persistRawMessages: false
      maxStoredTextChars: 512
```

`privacy.maxStoredTextChars` counts Unicode code points, including the
ellipsis added when stored text is truncated. `analysis.maxContextBytes`
counts UTF-8 bytes, also including any truncation ellipsis.

`retention.maxRecordsPerWorkspace` bounds durable evidence independently for
each workspace. After an insert, the oldest records in that workspace are
deleted until the limit is met; records belonging to other workspaces are not
counted or removed. The storage-domain API currently has no secondary index,
so retention performs a workspace-filtered table scan when a record is
inserted. Status counting is a single pass and does not materialize or sort
records.

Live candidates are also bounded. At most `live.maxPendingSessions` session
IDs and `live.maxPendingEventsPerSession` matching event IDs per session are
kept in memory. Entries expire after `live.pendingTtlMs` without a session
event. Capacity and TTL evictions emit metadata-only warnings; pending state
is cleared when the plugin is disposed.

## Development

```bash
pnpm --filter @yadsh/dsh-user-correction-miner check
```

## License

MIT
