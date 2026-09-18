import { generateTypert } from "@yadsh/dsh-plugin-scripts/generate-typert";

await generateTypert({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-preset-persona-editor",
  runtimeId: "dsh-preset-persona-editor",
  serviceName: "presetPersonaEditor",
});
