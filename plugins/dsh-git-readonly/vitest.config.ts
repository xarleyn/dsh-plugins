import { definePluginVitestConfig } from "@yadsh/dsh-config/vitest";

/**
 * Every git suite builds a throwaway repository in `beforeAll` (the mutation
 * suite builds two and clones one), i.e. a dozen `git` spawns per file. Vitest
 * gives a hook 10s, and a full `nx run-many -t test` on Windows does not meet
 * it: process creation, not git work, eats the budget, so `mutation`,
 * `tools-blame`, `tools-context` and `tools-history` fail before their first
 * test. CI never sees it because it runs one project per job on Linux.
 */
export default definePluginVitestConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 90_000,
  },
});
