import { definePluginVitestConfig } from "@yadsh/dsh-config/vitest";

export default definePluginVitestConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
