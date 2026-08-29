import {
  mergeConfig,
  type UserConfig,
  type UserConfigExport,
} from "vitest/config";

/**
 * Shared Vitest preset for DSH plugin packages (SPEC §23).
 *
 * Defaults mirror the standard plugin setup: Node environment, global test
 * APIs, and Vitest's default test-file discovery (`.test.ts` / `.spec.ts`).
 *
 * Reuse as-is:
 *
 * ```ts
 * // vitest.config.ts
 * export { default } from "@yadsh/dsh-config/vitest";
 * ```
 *
 * Or extend with package-specific options (overrides win):
 *
 * ```ts
 * // vitest.config.ts
 * import { definePluginVitestConfig } from "@yadsh/dsh-config/vitest";
 *
 * export default definePluginVitestConfig({
 *   test: {
 *     environment: "jsdom", // client-side plugin code
 *   },
 * });
 * ```
 */

export const baseConfig: UserConfig = {
  test: {
    globals: true,
    environment: "node",
  },
};

export default baseConfig;

/**
 * Extend the shared preset with package-specific Vitest options.
 * Deep-merges on top of {@link baseConfig}; `overrides` wins on conflicts.
 */
export function definePluginVitestConfig(
  overrides: UserConfig = {},
): UserConfigExport {
  return mergeConfig(baseConfig, overrides) as UserConfigExport;
}
