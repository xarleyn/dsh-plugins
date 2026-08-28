import { defineConfig, type Options } from "tsdown";

/**
 * Shared tsdown build preset for DSH plugin packages (SPEC §23).
 *
 * Produces `lib/` output with sourcemaps, matching the standard plugin
 * `package.json` layout (`main: ./lib/index.js`).
 *
 * Reuse as-is:
 *
 * ```ts
 * // tsdown.config.ts
 * export { default } from "@scope/dsh-config/build/tsdown";
 * ```
 *
 * Or extend with package-specific options:
 *
 * ```ts
 * // tsdown.config.ts
 * import { definePluginBuildConfig } from "@scope/dsh-config/build/tsdown";
 *
 * export default definePluginBuildConfig({
 *   entry: ["src/index.ts", "src/client.ts"],
 * });
 * ```
 *
 * Note: `entry` is replaced wholesale when provided (it is not concatenated
 * with the default); all other options are shallow-merged with the
 * package's values winning.
 */

/** Single-build tsdown config, as used by every package in this monorepo. */
type PluginBuildConfig = Omit<Options, "config" | "filter">;

export const baseConfig: PluginBuildConfig = {
  entry: ["src/index.ts"],
  sourcemap: true,
  clean: true,
  outDir: "lib",
  dts: false,
};

export default defineConfig(baseConfig);

/** Extend the shared preset with package-specific build options. */
export function definePluginBuildConfig(
  overrides: PluginBuildConfig = {},
): PluginBuildConfig {
  const { entry, ...rest } = overrides;
  return {
    ...baseConfig,
    ...rest,
    entry: entry ?? baseConfig.entry,
  };
}
