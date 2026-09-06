import { generateTypert } from "@yadsh/dsh-plugin-scripts/generate-typert";

await generateTypert({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-plugin-log-ui",
  runtimeId: "dsh-plugin-log-ui",
  serviceName: "pluginLogUi",
});
