import { readFileSync } from "node:fs";
import { definePluginVitestConfig } from "@yadsh/dsh-config/vitest";

const packageVersion = (
  JSON.parse(
    readFileSync(new URL("./package.json", import.meta.url), "utf8"),
  ) as { version: string }
).version;

export default definePluginVitestConfig({
  define: {
    __DSH_QA_VERSION__: JSON.stringify(packageVersion),
  },
});
