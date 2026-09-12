import { generateTypert } from "@yadsh/dsh-plugin-scripts/generate-typert";

await generateTypert({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-domain-experts",
  runtimeId: "dsh-domain-experts",
  serviceName: "domainExperts",
});
