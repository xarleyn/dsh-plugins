/**
 * DSH home resolution for plugin runtime helpers.
 *
 * Kept free of DSH runtime dependencies so the logger can be used by any
 * server-side package.
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Resolve the DSH home directory: `$DSH_HOME` when set to a non-blank value,
 * otherwise `~/.dsh` (the same convention as `dsh-draft-sessions` storage).
 */
export function resolveDshHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.DSH_HOME?.trim();
  return configured ? resolve(configured) : join(homedir(), ".dsh");
}
