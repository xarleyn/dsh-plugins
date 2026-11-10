import { realpath } from "node:fs/promises";
import {
  CODE_SOURCE_PARAMETER,
  selectCodeSource,
} from "@yadsh/dsh-plugin-kit/code-sources";
import { GitToolError } from "../errors.js";
import {
  resolveToolRepository,
  type GitRunner,
  type ToolExec,
} from "../git/repo.js";
import type { GitToolDeps } from "./shared.js";

export { CODE_SOURCE_PARAMETER };

export function sourceCatalog(deps: GitToolDeps) {
  return deps.config.codeSources.entries.length > 0
    ? deps.config.codeSources
    : (deps.codeSources?.() ?? deps.config.codeSources);
}

export interface GitSourceIdentity {
  readonly root: string;
  readonly source?: string;
  readonly sourceLabel?: string;
}

export const GIT_SOURCE_PROPERTIES = {
  source: { type: "string" as const },
  sourceLabel: { type: "string" as const },
  root: { type: "string" as const, required: true as const },
};

export function sourceHeading(value: GitSourceIdentity): string {
  return `${value.source === undefined ? "" : `[${value.source}] `}repository: ${value.root}`;
}

/** Explicit paths retain legacy behaviour; a source id is fenced by the same roots. */
export async function resolveGitSource(
  run: GitRunner,
  exec: ToolExec,
  args: Record<string, unknown>,
  deps: GitToolDeps,
): Promise<GitSourceIdentity> {
  if (args["source"] !== undefined && args["repository"] !== undefined)
    throw new GitToolError(
      "invalid-argument",
      "Pass source or repository, not both.",
    );
  const selected =
    args["repository"] === undefined
      ? selectCodeSource(sourceCatalog(deps), args["source"])
      : undefined;
  const root = await resolveToolRepository(
    run,
    exec,
    selected?.path ?? args["repository"],
    {
      timeoutMs: deps.config.timeoutMs,
      repositoryRoots: deps.config.repositoryRoots,
    },
  );
  if (selected === undefined) return { root };
  // A configured tree must be the repository itself, never an ancestor checkout.
  if ((await realpath(selected.path)) !== (await realpath(root)))
    throw new GitToolError(
      "invalid-repository",
      "Selected source path must be a Git work-tree root.",
    );
  return { root, source: selected.id, sourceLabel: selected.label };
}
