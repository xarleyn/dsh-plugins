import { definePluginVitestConfig } from "@yadsh/dsh-config/vitest";

export default definePluginVitestConfig({
  test: {
    coverage: { reporter: ["text", "json"] },
  },
});
