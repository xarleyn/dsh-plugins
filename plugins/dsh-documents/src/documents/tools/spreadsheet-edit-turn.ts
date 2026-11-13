import path from "node:path";
import { DocumentError } from "../errors.js";
import { sanitizeFilename } from "../security/paths.js";
import type { DocumentToolExec } from "./shared.js";

interface EditTurn {
  seq: number;
  outputs: Map<string, { path: string; sha256: string } | null>;
}

/** Prevent two batches in a turn from silently branching off the same input. */
export class SpreadsheetEditTurn {
  private readonly sessions = new WeakMap<object, EditTurn>();

  reserve(
    exec: DocumentToolExec,
    file: string,
    hash: string,
    filename?: string,
  ) {
    const session = exec.agent?.session;
    const projections = (
      exec.agent?.ctx as
        | {
            sessionProjections?: {
              stateOf: (
                session: object,
                key: "turnBoundary",
              ) => { openTurnStartSeq?: number | null } | undefined;
            };
          }
        | undefined
    )?.sessionProjections;
    const seq =
      session &&
      projections?.stateOf(session, "turnBoundary")?.openTurnStartSeq;
    if (!session || typeof seq !== "number") return;
    let turn = this.sessions.get(session);
    if (!turn || turn.seq !== seq) {
      turn = { seq, outputs: new Map() };
      this.sessions.set(session, turn);
    }
    const sourcePath = path.resolve(session.header.cwd!, file);
    const source = path.parse(sourcePath);
    const key = JSON.stringify([
      sourcePath,
      hash,
      sanitizeFilename(
        filename,
        source.name.replace(/-edited$/u, "") + "-edited",
        source.ext,
      ),
    ]);
    const entries = turn.outputs;
    if (entries.has(key)) {
      const prior = entries.get(key);
      throw new DocumentError(
        "INVALID_INPUT",
        prior
          ? `This input already produced this output name in the current turn. No file created. Continue from file=${JSON.stringify(prior.path)}, expectedSha256=${prior.sha256}; use a different filename only for an intentional alternative.`
          : "An edit of this input to this output name is already running. Wait for its returned path and hash.",
      );
    }
    entries.set(key, null);
    return {
      finish: (output: { path: string; sha256: string }) =>
        entries.set(key, output),
      cancel: () => entries.delete(key),
    };
  }
}
