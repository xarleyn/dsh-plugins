import { definePluginVitestConfig } from "@yadsh/dsh-config/vitest";

export default definePluginVitestConfig({
  test: {
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
    },
  },
});
