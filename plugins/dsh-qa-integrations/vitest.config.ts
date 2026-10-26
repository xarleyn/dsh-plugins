import { definePluginVitestConfig } from "@yadsh/dsh-config/vitest";

// Bound DOM and SQLite fixture concurrency on shared development and CI hosts.
export default definePluginVitestConfig({
  test: { maxWorkers: 2 },
});
