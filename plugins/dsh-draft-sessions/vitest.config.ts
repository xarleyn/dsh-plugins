import { definePluginVitestConfig } from "@yadsh/dsh-config/vitest";

export default definePluginVitestConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/host/**/*.ts", "src/shared/**/*.ts"],
    },
  },
});
