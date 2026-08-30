import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const client = await readFile(
  new URL("../lib/client.js", import.meta.url),
  "utf8",
);

assert.match(client, /window\.__ModuleLoader__\.load\(\{/);
assert.match(client, /id:\s*"@yadsh\/dsh-l10n-overrides"/);
