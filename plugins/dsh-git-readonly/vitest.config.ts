import { definePluginVitestConfig } from "@yadsh/dsh-config/vitest";

/**
 * Every git suite builds a throwaway repository in `beforeAll` (the mutation
 * suite builds two) and its snapshot tests walk that repository afterwards, so a
 * file spends dozens of `git` spawns and full-tree reads. Vitest gives a hook
 * 10s and a test 5s, and a full `nx run-many -t test` on Windows meets neither:
 * eight parallel projects make process creation and file I/O expensive, and the
 * heaviest snapshot test costs 1s alone but over 30s under that load. A hook
 * that misses its budget also hides the miss — Vitest marks that file's tests
 * `skipped` while counting the file `failed`, which is how the 22.09 slice read
 * as six failures. CI never sees any of it because it runs one project per job
 * on Linux.
 */
export default definePluginVitestConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: 90_000,
  },
});
