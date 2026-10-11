import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const client = await readFile(
  new URL("../lib/client.js", import.meta.url),
  "utf8",
);
const expectedRegistration = `id: ${JSON.stringify(packageJson.name)}`;

assert.ok(
  client.includes(expectedRegistration),
  `client bundle must register the full package name: ${packageJson.name}`,
);
assert.doesNotMatch(
  client,
  /^\s*export\s/m,
  "client bundle must remain a classic ModuleLoader script without ESM exports",
);

// The Host evaluates the classic bundle without Node globals. Checking only
// its registration text misses dependencies that read process during import.
let registration;
runInNewContext(client, {
  window: {
    __ModuleLoader__: {
      load(value) {
        registration = value;
      },
    },
  },
});
assert.equal(registration?.id, packageJson.name);
const imported = [];
const exports = registration.factory((specifier) => {
  imported.push(specifier);
  assert.ok(
    ["react", "react/jsx-runtime", "react-dom"].includes(specifier),
    `Unexpected browser runtime dependency: ${specifier}`,
  );
  return {};
});
assert.equal(typeof exports.apply, "function");
assert.ok(imported.includes("react/jsx-runtime"));
assert.deepEqual(Array.from(exports.inject), ["slots", "configForms"]);
