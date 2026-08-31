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
    analysis:
      maxContextEvents: 20
      maxContextBytes: 32768
    privacy:
      redactSecrets: true
      persistRawMessages: false
      maxStoredTextChars: 512
```

## Development

```bash
pnpm --filter @yadsh/dsh-user-correction-miner check
```

## License

MIT
