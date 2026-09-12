/**
 * Ambient environment keys removed from every spawned git process.
 *
 * A hostile or polluted parent environment could otherwise redirect git at
 * another repository, inject config, or swap in external helpers. Git also
 * reads some of these from `.git/config` of the inspected repository, which
 * the hardening CLI flags neutralize; this list closes the ambient half.
 */
export const REMOVED_ENV_KEYS: readonly string[] = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_NAMESPACE',
  'GIT_EXTERNAL_DIFF',
  'GIT_DIFF_OPTS',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_GLOBAL',
  'GIT_ASKPASS',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'GIT_PROXY_COMMAND',
  'GIT_PAGER',
];

/**
 * Hardened values forced on top of the (filtered) parent environment.
 *
 * - `GIT_OPTIONAL_LOCKS=0` stops git from refreshing the index or taking
 *   opportunistic locks, so even `git status`-style reads never write.
 * - `GIT_TERMINAL_PROMPT=0` and the removed askpass keys make git fail
 *   instead of hanging on credentials (nothing here talks to a network).
 * - `GIT_CONFIG_NOSYSTEM=1` keeps the machine-wide config out of the read.
 * - `LC_ALL=C` plus `GIT_PAGER`/`PAGER=cat` give deterministic, unpaged
 *   output regardless of the host locale.
 */
export const FORCED_ENV_VALUES: Readonly<Record<string, string>> = {
  LC_ALL: 'C',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_PAGER: 'cat',
  PAGER: 'cat',
};

/** Build the environment for one git invocation from the parent environment. */
export function buildGitEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const removed = new Set<string>(REMOVED_ENV_KEYS);
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined || removed.has(key)) continue;
    env[key] = value;
  }
  Object.assign(env, FORCED_ENV_VALUES);
  return env;
}
