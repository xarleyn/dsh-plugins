import { generateTypert } from "@yadsh/dsh-plugin-scripts/generate-typert";

await generateTypert({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-qa-surface",
  runtimeId: "dsh-qa-surface",
  serviceName: "qaSurface",
});
