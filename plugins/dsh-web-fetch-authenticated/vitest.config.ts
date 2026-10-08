import { definePluginVitestConfig } from "@yadsh/dsh-config/vitest";

/**
 * The redirect suites drive a local HTTP fixture. Vitest's default five seconds
 * covers that on an idle machine — the file costs 55ms on its own — but a full
 * `nx run-many -t test` on Windows runs eight projects at once, and one of these
 * tests was observed to hit the cap while waiting on a loopback round-trip that
 * takes six milliseconds uncontended.
 */
export default definePluginVitestConfig({
  test: {
    testTimeout: 30_000,
  },
});
