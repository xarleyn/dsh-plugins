import { generateTypert } from "@yadsh/dsh-plugin-scripts/generate-typert";

await generateTypert({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-session-audit",
  runtimeId: "dsh-session-audit",
  serviceName: "sessionAudit",
});
