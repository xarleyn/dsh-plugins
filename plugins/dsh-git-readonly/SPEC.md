# SPEC: @yadsh/dsh-git-readonly

Read-only git provenance tools for DeepSeek Harness agents.

## 1. Product contract

1. An agent whose session has a working directory can learn, in one tool
   call, which repository it is in (`dsh_git_context`): work-tree root,
   branch or detached state, upstream, HEAD id, last commit author/date and
   subject, and decorated refs.
2. An agent can find the commit that introduced or removed a literal string
   (`dsh_git_history` with `search: "content"`), locate commits by
   commit-message substring, author, path or ref scope, and page through
   the results with an explicit `truncated` marker.
3. An agent can attribute any line of a repository file to the commit that
   last changed it (`dsh_git_blame`), optionally in a line window and at a
   historical revision, and then inspect that commit (`dsh_git_show`):
   metadata, parents, per-file line counts, and a bounded patch.
4. The model never supplies a command line, a git option, or a git
   subcommand. Every argument is one of: a hexadecimal commit id
   (`/^[0-9a-fA-F]{7,64}$/`), a repository-relative path without `..`
   segments, a bounded literal search string, or a numeric limit.
5. The commit passed to `dsh_git_show` / `dsh_git_blame` is canonicalized
   by git itself (`rev-parse --verify --end-of-options <oid>^{commit}`)
   before use; only commits that exist resolve.
6. No tool call mutates the repository: refs, index, config and work tree
   are byte-identical before and after every call (proven by tests, §9).
7. A hostile repository cannot execute helpers through a read:
   `diff.external`, textconv drivers and `core.fsmonitor` configured in the
   inspected repository are never invoked (proven by tests, §9).
8. A poisoned ambient environment (`GIT_DIR`, `GIT_WORK_TREE`,
   `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, `GIT_EXTERNAL_DIFF`,
   `GIT_CONFIG_*`, askpass/ssh keys) cannot redirect a read; those keys are
   removed per invocation and deterministic values are forced.
9. Without a session working directory, or outside a git work tree, every
   tool fails closed with a typed error; there is no fallback to the host
   process cwd.
10. One call is bounded: timeouts (default 15 s, hard clamp 1–30 s), byte
    caps for patches (default 200 KiB) and stdout, page sizes for history
    (default 20, max 100) and blame lines (default 300). Exceeding a cap
    yields `truncated: true`, never a hang or an unbounded answer.

## 2. Surface

| Tool | Parameters (model-facing) | Result |
| --- | --- | --- |
| `dsh_git_context` | — | root, branch?, detached, upstream?, head?, shortOid?, author?, authoredAt?, subject?, refs[] |
| `dsh_git_history` | path?, query?, search?, author?, limit?, offset?, all? | commits[] {oid, shortOid, author, authoredAt, subject, refs[]}, count, truncated |
| `dsh_git_show` | oid (required), path?, statOnly? | oid, shortOid, author, authoredAt, subject, body, parents[], files[] {path, additions?, deletions?}, patch, patchTruncated |
| `dsh_git_blame` | file (required), fromLine?, toLine?, oid? | file, fromLine, toLine, lines[] {line, oid, author, authoredAt, summary, content}, truncated |

Errors carry stable codes: `no-session-cwd`, `not-a-git-repository`,
`invalid-oid`, `invalid-path`, `invalid-argument`, `git-timeout`,
`git-failed`.

## 3. Data flow

```
model → tools.execute(args, exec)
          │ validateCommitOid / validateRepoRelativePath / validateSearchLiteral
          │ requireSessionCwd(exec.agent.session.header.cwd)   ← fail-closed
          │ resolveRepositoryRoot: git rev-parse --show-toplevel
          ▼
        runGit(argv, {cwd, timeoutMs, maxBytes})
          │ argv = [program, …prefix, --no-pager, -c core.fsmonitor=false,
          │         -c core.quotepath=false, …subcommand]
          │ env = parent − removed git keys + forced deterministic values
          ▼
        git  ──byte-capped stdout──▶ parsers (--format + %x1f, numstat,
                                      porcelain) ──▶ structured result
```

## 4. Trust boundaries

- **Repository content is untrusted data.** Commit messages, branch names,
  patches and file content are returned as data; every tool description
  tells the model so. The plugin never parses untrusted output into
  behavior.
- **Repository configuration is untrusted.** `.git/config` and
  `.gitattributes` of the inspected repo may point diff/textconv/fsmonitor
  at executables; the hardening flags disable all three paths, and §9
  proves it.
- **The parent environment is untrusted.** Ambient git redirection keys are
  stripped per invocation (§1.8).

## 5. Configuration

See the README configuration table. All limits are clamped into safe
corridors by `resolveGitReadonlyConfig`; `enabled: false` removes the tool
surface entirely instead of registering inert tools.

## 6. Hardening invariants (runner)

1. argv array only; no `shell:`; `windowsHide`; stdin ignored.
2. Prefix flags on every invocation: `--no-pager`, `-c core.fsmonitor=false`,
   `-c core.quotepath=false`.
3. Diff-producing commands add `--no-ext-diff --no-textconv --no-color`
   (`dsh_git_show`, and `dsh_git_history` because pickaxe runs the diff
   machinery); `dsh_git_blame` adds `--no-textconv` (blame honors textconv
   by default).
4. Environment: `REMOVED_ENV_KEYS` stripped; `LC_ALL=C`,
   `GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`, `GIT_CONFIG_NOSYSTEM=1`,
   `GIT_PAGER=cat`, `PAGER=cat` forced.
5. The child is killed at the byte cap or the timeout (with SIGKILL
   escalation) and the result reports `truncated` / `timedOut`.

## 7. Lifecycle

The plugin is stateless: `apply` resolves config and registers four tools;
registrations are collected by the Cordis plugin scope on dispose/reload.
Nothing is stored on disk beyond plugin log records (tool names, exit
codes, durations, truncation flags — never content).

## 8. Scope

**Included:** the four provenance tools, validation, hardening, structured
bounded output, typed errors, mutation tests.

**Deferred (deliberately):**

- a generic `git(command)` tool or shell escape hatch — the entire point is
  to not have one;
- write operations (commit, checkout, stash, config, worktree, hooks);
- network operations (fetch, push, clone, submodule) — absent by design;
- OS-level confinement (mount namespaces, bubblewrap) — the tools are
  read-only by construction; an OS sandbox would strengthen the promise but
  is platform-dependent (Linux-only in current harness sandboxes) and
  unnecessary for the contract above;
- `dsh-session-scope` integration — focused scopes do not confine child
  processes; if a scoped deployment needs subtree-fenced history, the
  session-scope host API should grow a `visibleRoots` seam first.

## 9. Mutation test contract

The suite in `tests/mutation.test.ts` is normative for regressions:

- snapshot (work tree + `.git` minus reflogs) before/after every tool call,
  twice in sequence, must be byte-identical;
- a repository whose `.git/config` wires `diff.external`, a textconv driver
  and `core.fsmonitor` to a marker-writing helper must never produce the
  marker from any tool call, while still returning correct output;
- poisoned `GIT_DIR` / `GIT_EXTERNAL_DIFF` / `GIT_INDEX_FILE` /
  `GIT_WORK_TREE` / `GIT_OBJECT_DIRECTORY` in the parent environment must
  not redirect reads;
- `../` traversal in any path argument must be rejected before spawning;
- an oversized patch must be truncated and flagged;
- missing session cwd / non-repository cwd must fail closed.

## 10. Implementation status

| Area | Status |
| --- | --- |
| `dsh_git_context` | Implemented |
| `dsh_git_history` | Implemented |
| `dsh_git_show` | Implemented |
| `dsh_git_blame` | Implemented |
| Runner hardening (argv/env/caps/kill) | Implemented |
| Mutation test contract (§9) | Implemented |
| OS-level confinement | Deferred (see §8) |
| session-scope subtree fencing | Deferred (see §8) |
