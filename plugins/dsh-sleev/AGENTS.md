# Repository instructions

## Development workflow

- Keep changes scoped to the current implementation milestone.
- Create a Git commit after each meaningful, verified milestone instead of
  accumulating the whole feature in one large commit.
- Run the checks appropriate to the milestone before committing; for ordinary
  TypeScript changes, prefer `pnpm check`.
- Use concise conventional commit subjects that describe the delivered outcome.
- Do not rewrite or squash earlier milestone commits unless the user asks.

## Documentation discipline

- Update the relevant Markdown files whenever user-visible behavior,
  installation, configuration, compatibility, CI/CD, or release behavior
  changes.
- Keep `README.md` and `README.zh-CN.md` aligned in structure and technical
  meaning; update both in the same milestone when shared content changes.
- Keep commands, package names, versions, badges, and cross-document links
  current. Do not leave copied documentation that describes another plugin.
- Update focused documents under `docs/` when their subject changes instead of
  overloading the README with implementation detail.

## Architecture invariants

- Never mutate DSH `GenerateOptions` or downstream `StreamChunk` objects.
- Never serialize prompts, request headers, credentials, or secret values into
  telemetry.
- Keep Sleev-specific transport details isolated from generic observation and
  aggregation code.
- Keep native DSH compaction distinct from external gateway optimization.
