import { generateTypert } from "@yadsh/dsh-plugin-scripts/generate-typert";

await generateTypert({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-openviking-memory",
  runtimeId: "dsh-openviking-memory",
  serviceName: "openvikingMemory",
});
