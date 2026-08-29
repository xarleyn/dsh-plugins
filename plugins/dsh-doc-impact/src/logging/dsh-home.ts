/**
 * DSH home resolution for plugin runtime helpers.
 *
 * Part of the future `@yadsh/dsh-plugin-log` package seed: this folder is a
 * verbatim, self-contained copy in every adopting plugin (guidelines §5.2),
 * so keep it free of imports outside `./`.
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
