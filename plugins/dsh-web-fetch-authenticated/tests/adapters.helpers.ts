/**
 * Content adapter suite (SPEC §15.2/§26): URL recognition, REST URL
 * construction, markup conversion, normalization output, seam fall-through,
 * and the full provider path over a local Jira-like REST fixture.
 */

import type { AdapterRequestContext } from "../src/adapters/index.js";
import type { ResolvedAdapter, ResolvedRule } from "../src/types.js";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";

/** A logger the audits can write into without any output. */
export function silentLogger(): PluginLogger {
  return {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    child: () => silentLogger(),
    level: "error",
    setLevel: () => {},
  } as unknown as PluginLogger;
}

export function adapterSettings(
  overrides: Partial<ResolvedAdapter> = {},
): ResolvedAdapter {
  return {
    type: "jira",
    jiraFlavor: "server",
    includeComments: false,
    includeLinks: false,
    cleanup: "balanced",
    maxAttachments: 50,
    ...overrides,
  };
}

export function context(
  adapter: ResolvedAdapter,
  overrides: Partial<AdapterRequestContext> = {},
): AdapterRequestContext {
  const rule = { adapter, source: { id: "r" } } as unknown as ResolvedRule;
  return {
    rule,
    rules: [rule],
    globals: { maxUrlLength: 2048, userAgent: "test" },
    resolveSecrets: async () => ({}),
    ...overrides,
  };
}
