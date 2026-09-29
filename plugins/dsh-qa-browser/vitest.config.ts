import { definePluginVitestConfig } from "@yadsh/dsh-config/vitest";

export default definePluginVitestConfig({
  test: {
    testTimeout: 30_000,
  },
});
