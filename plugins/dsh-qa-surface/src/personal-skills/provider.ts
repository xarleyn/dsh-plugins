import type {
  SkillCandidate,
  SkillDefinition,
  SkillLookupOptions,
  SkillProvider,
  SkillProviderControl,
} from "@deepseek-ai/dsh-skill";
import type { QaPersonalSkills, QaStoredSkill } from "./service.js";

/**
 * Discovery provider for one QA account's own skills.
 *
 * It exists because the shipped filesystem provider resolves the project root
 * through the nearest `.git`, which for a personal QA directory inside a larger
 * checkout would climb above the account and mix users together. This provider
 * reads exactly one place — `<cwd>/.dsh/skills` where the cwd is a provisioned
 * `.qa-users/<uuid>` directory — and replaces the filesystem layer inside the
 * QA scope rather than adding a second one beside it.
 */

export const QA_USER_SKILLS_PROVIDER = "qa-user-skills";
/** Prompt-visible provenance label for a skill stored in an account directory. */
export const QA_USER_SKILLS_SOURCE = "qa-user";
/**
 * Rank below the project layer (100) and the bundled layer (600): inside the
 * QA scope a personal skill wins a same-named duplicate from any other layer.
 */
export const QA_USER_SKILLS_RANK = 50;

/** The opaque handle a candidate carries back into {@link SkillProvider.get}. */
interface QaSkillLocator {
  /** Directory name only: `get` re-derives the path from its own options. */
  readonly directory: string;
}

function locatorOf(value: unknown): string | undefined {
  const directory = (value as QaSkillLocator | undefined)?.directory;
  return typeof directory === "string" && directory !== ""
    ? directory
    : undefined;
}

/**
 * The cwd a lookup is about. The registry's declared provider contract has
 * only `cwd`, but it hands the caller's borrowed view options down as they
 * are, so a scoped read also carries the calling agent — useful because an
 * agent-scoped lookup does not always repeat the cwd.
 */
function lookupCwd(options: SkillLookupOptions): string | undefined {
  if (typeof options.cwd === "string" && options.cwd !== "") return options.cwd;
  const scope = (options as { readonly scope?: unknown }).scope;
  const cwd = (
    scope as
      | { readonly session?: { readonly header?: { readonly cwd?: unknown } } }
      | undefined
  )?.session?.header?.cwd;
  return typeof cwd === "string" && cwd !== "" ? cwd : undefined;
}

function candidateOf(stored: QaStoredSkill): SkillCandidate | undefined {
  const contents = stored.contents;
  if (contents === undefined) return undefined;
  return {
    name: contents.name,
    description: contents.description,
    ...(contents.whenToUse === null ? {} : { whenToUse: contents.whenToUse }),
    invocation: {
      modelInvocable: contents.modelInvocable,
      userInvocable: contents.userInvocable,
    },
    source: QA_USER_SKILLS_SOURCE,
    provider: QA_USER_SKILLS_PROVIDER,
    resourceBase: { kind: "directory", path: stored.directory },
    rank: QA_USER_SKILLS_RANK,
    locator: { directory: stored.directoryName } satisfies QaSkillLocator,
    path: stored.filePath,
    // The registry drops metadata from its summaries, so `allowed-tools` is
    // readable here and by anyone who inspects a candidate — nothing in the
    // harness enforces it, and nothing here claims otherwise.
    metadata: { allowedTools: [...contents.allowedTools] },
  };
}

function definitionOf(
  stored: QaStoredSkill,
  candidate: SkillCandidate,
): SkillDefinition | undefined {
  const contents = stored.contents;
  if (contents === undefined) return undefined;
  return { ...candidate, content: contents.body };
}

/**
 * Build the provider for one registration. The factory runs synchronously
 * during `registerProvider` and all filesystem work stays inside
 * `list`/`get`, which the registry calls per read.
 *
 * Note what the registry caches and what it does not: a loaded definition is
 * never cached, so an edited body is visible to the next `get` immediately,
 * while the candidate list behind a catalog summary is cached until something
 * invalidates it. A save goes through the service, which invalidates; a file
 * edited by hand is what the watcher exists for.
 */
export function createQaUserSkillProvider(
  control: SkillProviderControl,
  skills: QaPersonalSkills,
): SkillProvider {
  return {
    name: QA_USER_SKILLS_PROVIDER,
    list: async (options) => {
      if (control.signal.aborted) return [];
      const cwd = lookupCwd(options);
      if (cwd === undefined) return [];
      return skills
        .discover(cwd)
        .map(candidateOf)
        .filter(
          (candidate): candidate is SkillCandidate => candidate !== undefined,
        );
    },
    get: async (candidate, options) => {
      if (control.signal.aborted) return undefined;
      const cwd = lookupCwd(options);
      if (cwd === undefined) return undefined;
      const directory = locatorOf(candidate.locator);
      if (directory === undefined) return undefined;
      const stored = skills.read(cwd, directory);
      if (stored === undefined) return undefined;
      return definitionOf(stored, candidate);
    },
  };
}
