---
"@yadsh/dsh-openviking-memory": patch
---

Automatic recall is unchanged; the module behind it is now eight, each with one
reason to change.

`src/openviking/recall-core.ts` had grown past a thousand lines while carrying
three jobs that move separately — what is asked of the memory backend, which of
the retrieved items a turn is shown, and how those are rendered into the prompt.
A change to the server's request contract, to the ranking rule, and to the shape
of the injected block all landed in the same file, and none of them could be
reviewed as one subject.

The parts now live in `src/openviking/recall/`: `request-body.ts` (the bodies of
the two search faces, the quota arithmetic behind them, and the per-stage HTTP
deadlines), `source-search.ts` (the raw `find` sweep and the user space its URIs
resolve against), `server-assembled.ts` (the context face, the deprecated
`/recall` preset behind it, and the rejections that mean a server predates a
field), `rank.ts` (the query profile, the boosts, the dedup), `format.ts` (the
token estimate, the per-item content, the envelope), `state-files.ts` (what one
turn leaves on disk for the next), `pipeline.ts` (the order those paths are
tried, including the second pass for a workspace's former peer), and `types.ts`
for the vocabulary they share. `docs/upstream-sync.md` points a sync at the
directory, and at the one file that carries this fork's type widenings.

Nothing a caller can see moves. `recall-core.ts` stays as the re-export, so the
import path, the twelve public names, and their types are what they were; the
lines were moved as written, with `export` and `import` as the only additions;
and the module's load-time effects — no I/O, one mutable cache — are unchanged.
