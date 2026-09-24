import { definePluginVitestConfig } from "@yadsh/dsh-config/vitest";

/**
 * The backend suites render through a configured executable, so each render
 * costs a real child process and its cold start. Vitest gives a test five
 * seconds and a full `nx run-many -t test` on Windows runs eight projects at
 * once: `pandoc provider > reports a failing backend with a sanitized message`,
 * which renders twice, was observed hitting that cap at 5036ms while its
 * neighbours cost up to four seconds. The cap is what failed the test.
 */
export default definePluginVitestConfig({
  test: {
    testTimeout: 30_000,
  },
});
