import { resolveAccounts } from "./config-resolvers/accounts.js";
import { resolveAttachments } from "./config-resolvers/attachments.js";
import {
  normalizeRoutePath,
  resolveBasics,
} from "./config-resolvers/basics.js";
import { DEFAULT_QA_SURFACE_CONFIG } from "./config-resolvers/defaults.js";
import { resolveLockdown } from "./config-resolvers/lockdown.js";
import { resolveSession } from "./config-resolvers/session.js";
import { resolveSources } from "./config-resolvers/sources.js";
import { uniquePhrases, uniqueQuestions } from "./config-resolvers/shared.js";
import { resolveTools } from "./config-resolvers/tools.js";
import { resolveUi } from "./config-resolvers/ui.js";
import type { QaSurfaceConfig, ResolvedQaSurfaceConfig } from "./types.js";

export { DEFAULT_QA_SURFACE_CONFIG, normalizeRoutePath };

/**
 * Materialize defaults and enforce route/session/model safety constraints by
 * running one resolver per config domain — in the order the checks have
 * always fired — and assembling the frozen result.
 */
export function resolveConfig(
  input: QaSurfaceConfig = {},
): ResolvedQaSurfaceConfig {
  const basics = resolveBasics(input);
  const session = resolveSession(input);
  const ui = resolveUi(input);
  const lockdown = resolveLockdown(input, ui);
  const sources = resolveSources(input);
  const attachments = resolveAttachments(input);
  const tools = resolveTools(input);
  const accounts = resolveAccounts(input, { session, lockdown });
  return Object.freeze({
    enabled: basics.enabled,
    route: basics.route,
    branding: basics.branding,
    session,
    ui,
    suggestedQuestions: uniqueQuestions(
      input.suggestedQuestions ?? DEFAULT_QA_SURFACE_CONFIG.suggestedQuestions,
    ),
    thinkingPhrases: uniquePhrases(
      input.thinkingPhrases ?? DEFAULT_QA_SURFACE_CONFIG.thinkingPhrases,
    ),
    interaction: basics.interaction,
    lockdown,
    embedding: basics.embedding,
    accounts,
    entry: basics.entry,
    sources,
    attachments,
    tools,
  });
}
