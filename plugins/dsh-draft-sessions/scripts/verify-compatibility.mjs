import { readFile } from "node:fs/promises";

const compatibility = JSON.parse(
  await readFile(new URL("../compatibility.json", import.meta.url), "utf8"),
);
const required = compatibility.deepseekHarness.requiredClientFeatures;
const expected = ["sidebar.footer.action"];
if (JSON.stringify(required) !== JSON.stringify(expected)) {
  throw new Error(
    `client feature contract mismatch: expected ${expected.join(", ")}`,
  );
}
