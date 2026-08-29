import { readFile } from "node:fs/promises";

const compatibility = JSON.parse(
  await readFile(new URL("../compatibility.json", import.meta.url), "utf8"),
);
const harness = compatibility.deepseekHarness;

if (!Array.isArray(harness?.testedReleases) || harness.testedReleases.length === 0) {
  throw new Error("compatibility.json must declare at least one tested DSH release");
}
for (const release of harness.testedReleases) {
  if (typeof release !== "string" || !/^0\.1\.1-rc\.\d+$/.test(release)) {
    throw new Error(`invalid tested DSH release ${JSON.stringify(release)}`);
  }
}

const expectedHost = [
  "fs.readBytes",
  "tools.guard",
  "tools/execute",
  "agent/pre-step",
  "sessionProjections",
  "sandbox.confine.full-enforcement",
];
const expectedClient = [
  "conversation.input.left",
  "remote.commands",
  "session-projections",
];

for (const [label, actual, expected] of [
  ["host", harness.requiredHostFeatures, expectedHost],
  ["client", harness.requiredClientFeatures, expectedClient],
]) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} feature contract mismatch: expected ${expected.join(", ")}`);
  }
}
