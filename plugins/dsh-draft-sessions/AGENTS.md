# Repository instructions

## Commit discipline

- Commit after each significant, independently verifiable implementation step once its relevant checks pass.
- Keep commits focused: do not mix unrelated lifecycle, UI, dependency, or documentation changes.
- Do not commit a known-broken intermediate state unless the user explicitly asks for it.
- Use concise Conventional Commit subjects matching the repository history, for example:
  - `feat: add blank session lifecycle bridge`
  - `fix: make pnpm installs reproducible in CI`
  - `ci: reduce Dependabot update noise`
  - `docs: document commit discipline`
- Before handing work back, commit any completed significant step unless the user explicitly asks to leave changes uncommitted.
