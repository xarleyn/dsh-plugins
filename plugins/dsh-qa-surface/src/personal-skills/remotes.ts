import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import type { QaAccountRemotes } from "../account-remotes.js";
import type {
  QaSkillDocument,
  QaSkillDraftInput,
  QaSkillRemoval,
  QaSkillSummary,
  QaSkillToolDescriptor,
  QaSkillValidation,
  ResolvedQaSurfaceConfig,
} from "../types.js";
import { QaPersonalSkillError } from "./errors.js";
import type { QaPersonalSkillContext, QaPersonalSkills } from "./service.js";

/**
 * Host-side bodies of the personal-skill remotes. The `@Remote`-decorated
 * signatures stay on the `QaSurface` service class (typert code generation
 * reads the class shape); this context owns everything behind them: turning
 * the wire's account token into the storage context, and mapping a refusal
 * onto the shared `(reason: <code>)` marker the browser renders copy for.
 *
 * The browser never names a filesystem location. It names a skill; the account
 * id behind the token decides where that name resolves.
 */
export interface QaPersonalSkillRemotes {
  list(token: string): { readonly skills: readonly QaSkillSummary[] };
  get(token: string, name: string): QaSkillDocument;
  create(token: string, input: QaSkillDraftInput): QaSkillDocument;
  update(
    token: string,
    name: string,
    input: QaSkillDraftInput,
  ): QaSkillDocument;
  remove(
    token: string,
    name: string,
    expectedRevision: string | null,
  ): QaSkillRemoval;
  validate(
    token: string,
    name: string | null,
    input: QaSkillDraftInput,
  ): QaSkillValidation;
  tools(token: string): { readonly tools: readonly QaSkillToolDescriptor[] };
  validate(
    token: string,
    name: string | null,
    input: QaSkillDraftInput,
  ): QaSkillValidation;
}

export function createQaPersonalSkillRemotes(options: {
  getConfig: () => ResolvedQaSurfaceConfig;
  logger: PluginLogger;
  skills: QaPersonalSkills;
  accounts: QaAccountRemotes;
}): QaPersonalSkillRemotes {
  const { getConfig, logger, skills, accounts } = options;

  /** The authenticated account behind the wire token; never a named user. */
  const contextOf = (token: string): QaPersonalSkillContext => {
    const store = accounts.resolve(getConfig());
    if (store === undefined) {
      throw new Error("QA accounts are not enabled on this deployment.");
    }
    const user = accounts.run(() => store.requireUser(token));
    return { userId: user.id };
  };

  const run = <T>(operation: () => T, skill?: string): T => {
    try {
      return operation();
    } catch (error) {
      if (error instanceof QaPersonalSkillError) {
        logger.warn("skill.rejected", {
          reason: error.reason,
          ...(skill === undefined ? {} : { skill }),
        });
        throw new Error(
          `QA personal skills refused the request (reason: ${error.reason})`,
          { cause: error },
        );
      }
      throw error;
    }
  };

  return {
    list: (token) => run(() => ({ skills: skills.list(contextOf(token)) })),
    get: (token, name) => run(() => skills.get(contextOf(token), name), name),
    create: (token, input) =>
      run(() => skills.create(contextOf(token), input), input.name),
    update: (token, name, input) =>
      run(() => skills.update(contextOf(token), name, input), name),
    remove: (token, name, expectedRevision) =>
      run(() => skills.remove(contextOf(token), name, expectedRevision), name),
    tools: (token) =>
      run(() => ({
        tools: skills.tools(contextOf(token)),
      })),
    validate: (token, name, input) =>
      run(() => skills.validate(contextOf(token), name, input), input.name),
  };
}
