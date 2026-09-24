import { definePluginVitestConfig } from "@yadsh/dsh-config/vitest";

/**
 * Every git suite builds a throwaway repository in `beforeAll` (the mutation
 * suite builds two) and the snapshot tests then walk it, so a file spends
 * dozens of real `git` spawns before its first assertion. Vitest gives a hook
 * 10s and a test 5s, and this package used to re-export the shared preset with
 * no override at all. A hook that misses its budget also hides the miss: Vitest
 * marks that file's tests `skipped` while counting the file `failed`, which is
 * how the 22.09 Windows slice read as six failures. CI never sees it because it
 * runs one project per job on Linux (#250).
 *
 * Widening the budgets alone did not hold. Vitest gives a project one worker per
 * logical CPU and every worker here builds repositories with real git children,
 * so a full `nx run-many -t test` measured this suite at over fifty times its
 * idle cost — the heaviest snapshot test cost 1s alone and 52s loaded — ran its
 * worst files to 139s and 103s, and lost three tests to a `git` child that came
 * back non-zero without a word, a shape no budget forgives. Two workers is
 * already past what this suite can keep busy (all twelve files cost 3.7s on an
 * idle machine), and under the same load its worst file then finishes in 65s,
 * inside the budgets above.
 */
export default definePluginVitestConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: 90_000,
    maxWorkers: 2,
  },
});
