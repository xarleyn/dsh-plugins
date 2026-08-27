# @scope/dsh-draft-sessions

Draft sessions plugin for DeepSeek Harness — manage session drafts and previews.

## Features

- Create and manage draft sessions
- Auto-save with configurable intervals
- Client-side API for draft operations
- DSH compatibility checking

## Requirements

- DeepSeek Harness >= 1.0.0

## Installation

npm:
```bash
dsh plugin add @scope/dsh-draft-sessions
```

Tarball:
```bash
dsh plugin add ./package.tgz
```

## Configuration

Add to your DSH profile configuration:

```yaml
draftSessions:
  maxDrafts: 50
  autoSaveInterval: 30000
```

## Compatibility

Tested with DeepSeek Harness 1.x.

## Development

```bash
pnpm build
pnpm test
pnpm typecheck
```

## License

MIT
