# Resuming

Three ways work resumes, and the first move in each. The common mistake is the
same in all three: re-deriving the picture from the repository instead of
reading what was already written down.

## 1. After a compaction (same session)

The runtime injects its own summary when the context runs out. Recognise it by
its shape — a `Summary:` block with numbered sections covering intent and
technical concepts.

What to do:

- treat the automated summary as **intent**, not as state: it rarely carries
  shas, paths or command lines;
- read your own checkpoint next, if one exists — that is exactly the gap it was
  written to fill;
- re-establish the ground truth before any edit: branch, `HEAD`, `git status`;
- re-read the files you were editing before writing to them; a compaction is not
  a reason to trust your memory of their contents.

Do **not** re-run the whole discovery: the summary plus the checkpoint is
intentionally a smaller set than the transcript.

## 2. In a fresh chat (one-word instruction)

Typical shape: the maintainer opens a new chat and writes `Продолжай`, or names
the topic in a sentence with no state ("мы там с тобой правили плагин").

Reconstruct in this order, stopping as soon as the picture is actionable:

1. **the checkpoint** for that topic in `.private/` — by name if you know it,
   otherwise by listing the directory for recently modified files;
2. **the memory index** `MEMORY.md` — durable facts and traps about the
   subsystem, which is where a resumed task usually trips;
3. **git ground truth** — `git status --short`, `git log --oneline -10`,
   `git rev-parse --short HEAD`, and the branch/worktree in use;
4. **the plan doc** if the effort is multi-stage — `docs/plans/` carries the
   per-stage status and is the one place a wave's position is written down;
5. **the previous transcript** by session id, only if the above is silent. This
   is the last resort: it costs the most and is not guaranteed to be complete
   for long sessions.

Then state the plan back in one short paragraph before starting — objective, the
next action, and the ownership situation of any uncommitted files. That
paragraph is what the maintainer is checking when he writes the one word.

## 3. Inside a subagent

Subagents start with an empty context and see only the brief. Two consequences:

- the brief **is** the checkpoint; a vague brief produces a subagent that
  re-explores the repository and returns generic findings;
- a good subagent brief carries: the objective, the workspace and branch, the
  files it may and may not touch, the exact deliverable shape, and which
  decisions are already settled (so it does not re-open them).

When the subagent returns, do not paste its conclusions into the checkpoint
unverified: record what was checked and what is still the subagent's claim.

## Auditing a checkpoint you inherit

Before trusting one, spend a minute on these:

- **sha check** — does the recorded `HEAD` match `git rev-parse --short HEAD`?
  If not, everything downstream may have moved; re-derive the state.
- **ownership check** — are the files listed as uncommitted still uncommitted,
  and still owned by the same writer? A parallel agent may have committed them.
- **verdict check** — recompute the cheapest recorded number (a test count, a
  file count). A checkpoint whose numbers no longer reproduce is a checkpoint to
  rewrite, not to follow.
- **expiry check** — is the task it describes actually still open? A merged PR
  behind a live-looking checkpoint sends the next reader into closed work.

If any check fails, fix the checkpoint first and say in your report that it was
stale; the next reader inherits your correction.
