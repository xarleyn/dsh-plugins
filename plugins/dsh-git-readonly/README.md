# @yadsh/dsh-git-readonly

Read-only git provenance tools for DeepSeek Harness agents: the model can
answer "what task was this changed for" against the session repository —
branch → history → blame → commit — without ever receiving a command line.

## Features

- **Four provenance tools**, registered into the host tool catalog:
  - `dsh_git_context` — work-tree root, current branch/detached state,
    upstream, HEAD commit, decorated refs;
  - `dsh_git_history` — bounded commit search by repository-relative path,
    literal commit-message substring, or literal introduced-content string
    (pickaxe), with optional author filter, pagination, and all-refs mode;
  - `dsh_git_show` — one commit by hexadecimal id: metadata, parents,
    per-file line counts, and a bounded patch; optional stats-only mode;
  - `dsh_git_blame` — line-level attribution for one file, with a line
    window and optional historical revision.
- **No command line for the model.** The model passes structured parameters
  only; the plugin builds the git argv itself. Commit ids must be pure
  hexadecimal; paths must be repository-relative (no `..`, no absolute
  paths) and are always passed after `--`; search text is a literal.
- **Hardened git execution.** Every invocation is an argv-array spawn (no
  shell), with `--no-pager`, fsmonitor disabled, external diff and textconv
  disabled, and a filtered environment: ambient `GIT_DIR`, `GIT_WORK_TREE`,
  `GIT_INDEX_FILE`, `GIT_EXTERNAL_DIFF`, `GIT_CONFIG_*`, askpass/ssh and
  similar keys are removed; `GIT_OPTIONAL_LOCKS=0`,
  `GIT_TERMINAL_PROMPT=0`, `GIT_CONFIG_NOSYSTEM=1` and `LC_ALL=C` are
  forced. The byte-capped, time-boxed process is killed at the limit and
  the truncation is reported in the result.
- **Fail-closed repository selection.** With no `repository` argument the
  tools use the session working directory. An explicit directory must remain
  inside that directory or an operator-configured `repositoryRoots` entry,
  both before and after Git resolves the work-tree root. Canonical-path checks
  reject traversal and symlink escapes. Nothing writes to the repository, and
  no network git command exists in the tool surface.
- **Bounded, structured output.** Commits, files, blame lines and patches
  come back as structured fields with explicit `truncated` flags, sized so
  one call cannot flood the model context.
- The mutation test suite proves the read-only guarantee byte-for-byte:
  refs, index, config and work tree are unchanged across every tool call,
  and hostile repositories with malicious `diff.external`, textconv or
  `core.fsmonitor` settings never execute those helpers (SPEC §9).

## Installation

Install the published npm package by name:

```bash
dsh plugin --profile <profile> add @yadsh/dsh-git-readonly
```

The plugin has no web-client surface; a host restart (or bundle reload)
picks it up. Tools appear as `dsh_git_context`, `dsh_git_history`,
`dsh_git_show` and `dsh_git_blame` in new agent sessions.

### Use in restricted agent presets (read-only surfaces)

To expose the tools inside a locked-down composition such as an
agent preset with a tool allow-list, mount the plugin in the preset's
`agent.cordis.yml` and name the four tools in the deployment's
`lockdown.toolPolicy.allow` list — the mount must exist before the
allow-list entry, otherwise attestation fails closed:

```yaml
# preset rows (agent.cordis.yml)
- id: dsh-git-readonly
  name: "@yadsh/dsh-git-readonly"

# lockdown.toolPolicy.allow (profile cordis.patch.yml), in addition to the
# existing read-only set:
#   - dsh_git_context
#   - dsh_git_history
#   - dsh_git_show
#   - dsh_git_blame
```

To let spawned subagents dig through history as well, add the same four
names to the `toolFilter.allow` list of the subagent tools.

## Configuration

Configure the plugin under the `git-readonly` key in the DSH profile.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | When `false`, the tools are not registered at all. |
| `gitPath` | string | `"git"` | Git executable used for the inspections. |
| `repositoryRoots` | string[] | `[]` | Absolute directory roots that tools may select with `repository`, in addition to the session directory. |
| `timeoutMs` | number | `15000` | Wall-clock budget per git invocation, clamped to 1000–30000 ms. |
| `history.defaultLimit` | number | `20` | History page size when the model omits `limit` (1–50). |
| `history.maxLimit` | number | `100` | Hard upper bound for one history page (1–200). |
| `blame.maxLines` | number | `300` | Maximum lines attributed by one `dsh_git_blame` call (1–1000). |
| `patchBytes` | number | `200000` | Maximum patch bytes returned by `dsh_git_show` (4096–1048576). |

For a QA session rooted at `E:/qa-assistant/workspaces/work` that must inspect
the sibling checkout, configure the plugin with
`repositoryRoots: ["E:/qa-assistant/workspaces/code"]`. Because this is the
only configured root, `dsh_git_context {}` automatically uses it when the
session cwd is not itself a repository. The model can also pass the absolute
path explicitly. With multiple configured roots the model must select one;
the tool parameter and the typed error both list the available roots.

## Security model

The tools are read-only by construction, not by policy: the git subcommands
are fixed, every model-supplied string is validated before it reaches the
process, and the execution environment strips every redirection the parent
shell or the repository could inject. What remains is *provenance reading* —
log, show, diff output, blame — of the session repository or an explicitly
configured directory root. This is a deliberately narrower authority than a shell with a git
allow-list and narrower than general git access: there is no fetch, push,
clone, checkout, config, worktree or hook surface, and no OS-level sandbox
is required or assumed (SPEC §8).

## Compatibility

- DeepSeek Harness >=0.1.5-rc.2 <0.2.0 (see `compatibility.json`)
- Node.js ^22.19.0 or >=24.0.0
- A `git` executable available to the host process (git 2.25+ recommended;
  the `--no-textconv` blame flag used against hostile textconv drivers is
  accepted by all supported versions).

## Development

```bash
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

The tests spawn a real `git`; they create throwaway repositories under the
system temp directory and clean them up afterwards.

## License

MIT
