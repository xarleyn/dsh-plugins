import { generateTypert } from "@yadsh/dsh-plugin-scripts/generate-typert";

await generateTypert({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-qa-integrations",
  runtimeId: "dsh-qa-integrations",
  serviceName: "qaIntegrations",
});
