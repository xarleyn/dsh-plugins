import { generateTypert } from "@yadsh/dsh-plugin-scripts/generate-typert";

await generateTypert({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-model-safety-gate",
  runtimeId: "dsh-model-safety-gate",
  serviceName: "safetyGate",
});
