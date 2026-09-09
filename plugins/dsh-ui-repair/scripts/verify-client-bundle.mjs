import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const client = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");

assert.match(
  client,
  /window\.__ModuleLoader__\.load\(\{\s*id:\s*"@yadsh\/dsh-ui-repair"/u,
);
assert.match(client, /data-dsh-ui-repair-scope/u);
assert.match(client, /data-dsh-ui-repair-target/u);
assert.match(client, /MutationObserver/u);
assert.doesNotMatch(client, /require\(["']@deepseek-ai\//u);
assert.doesNotMatch(client, /localStorage/u);
assert.doesNotMatch(client, /fetch\(/u);

process.stdout.write("verify-client-bundle: module identity and safety guards passed\n");
