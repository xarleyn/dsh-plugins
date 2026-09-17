import { definePluginVitestConfig } from "@yadsh/dsh-config/vitest";

export default definePluginVitestConfig({
  test: {
    environment: "jsdom",
  },
});
