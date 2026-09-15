import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("package.json", root), "utf8"),
);
assert.equal(manifest.name, "@yadsh/dsh-qa-integrations");
assert.equal(manifest.dsh?.bundle?.patch, "./cordis.patch.yml");
assert.equal(manifest.dsh?.client?.platform, "web");
assert(manifest.dependencies?.["@yadsh/dsh-qa-surface"]);

for (const file of [
  "lib/index.js",
  "lib/tools.js",
  "lib/client.js",
  "lib/typert.host.js",
  "lib/typert.host.d.ts",
  "lib/typert.remote-client.js",
  "lib/typert.remote-client.d.ts",
  "lib/types/index.d.ts",
  "lib/types/client/index.d.ts",
  "cordis.patch.yml",
  "compatibility.json",
  "README.md",
  "LICENSE",
]) {
  assert((await stat(new URL(file, root))).isFile(), `${file} must be built`);
}

const patch = await readFile(new URL("cordis.patch.yml", root), "utf8");
assert.match(patch, /id:\s*qa-integrations/u);
assert.match(patch, /name:\s*"@yadsh\/dsh-qa-integrations"/u);
assert.match(patch, /enabled:\s*false/u);

const client = await readFile(new URL("lib/client.js", root), "utf8");
assert.match(
  client,
  /window\.__ModuleLoader__\.load\(\{\s*id:\s*"@yadsh\/dsh-qa-integrations"/u,
);
assert.match(client, /"qaUserSettingsSections"/u);
assert.match(client, /title:\s*"Интеграции"/u);
assert.match(client, /type:\s*"password"/u);
// Every capability the agent may be granted is offered in the Settings card.
for (const label of [
  "Читать CRM",
  "Читать чаты",
  "Читать открытые линии",
  "Читать сотрудников",
  "Читать структуру компании",
  "Читать задачи",
  "Читать календарь",
  "Читать файлы Диска",
]) {
  assert.match(client, new RegExp(label, "u"));
}
assert.doesNotMatch(client, /localStorage|sessionStorage/u);
assert.doesNotMatch(client, /Показать токен|Копировать токен/u);

const tools = await readFile(new URL("src/tools.ts", root), "utf8");
for (const name of [
  "bitrix_search_crm",
  "bitrix_get_crm_item",
  "bitrix_get_crm_fields",
  "bitrix_get_crm_funnels",
  "bitrix_get_crm_statuses",
  "bitrix_get_crm_activities",
  "bitrix_get_crm_activity",
  "bitrix_get_crm_timeline",
  "bitrix_get_crm_stage_history",
  "bitrix_get_crm_product_rows",
  "bitrix_find_crm_duplicates",
  "bitrix_get_current_user",
  "bitrix_search_users",
  "bitrix_get_departments",
  "bitrix_search_chats",
  "bitrix_get_chat_messages",
  "bitrix_search_chat_messages",
  "bitrix_get_recent_chats",
  "bitrix_search_chat_users",
  "bitrix_get_openline_dialog",
  "bitrix_get_openline_history",
  "bitrix_search_tasks",
  "bitrix_get_task",
  "bitrix_get_calendar_events",
  "bitrix_get_calendar_accessibility",
  "bitrix_search_files",
  "bitrix_get_file",
]) {
  assert.match(tools, new RegExp(`name: "${name}"`, "u"));
}
for (const forbidden of [
  "userId:",
  "ownerUserId:",
  "credentialId:",
  "secretId:",
  "accessToken:",
  "refreshToken:",
  "raw_rest_call",
]) {
  assert.doesNotMatch(tools, new RegExp(forbidden, "u"));
}

// The capability table is the permission surface: nothing writable may reach it.
const catalog = await readFile(new URL("src/catalog.ts", root), "utf8");
const methods = [...catalog.matchAll(/method: "([^"]+)"/gu)].map(
  (match) => match[1],
);
const toolCount = [...tools.matchAll(/operation: "[^"]+"/gu)].length;
assert.equal(
  methods.length,
  toolCount,
  "every tool must name exactly one catalog operation",
);
for (const method of methods) {
  assert.doesNotMatch(
    method,
    /\.(add|update|delete|set|unset|bind|unbind|move|import|start|complete|renew|send|create|register)$/u,
    `${method} is not a read-only method`,
  );
}
for (const scope of [
  "crm",
  "im",
  "imopenlines",
  "user",
  "user_basic",
  "user_brief",
  "department",
  "task",
  "calendar",
  "disk",
]) {
  assert.match(catalog, new RegExp(`"${scope}"`, "u"));
}

const host = await readFile(new URL("lib/index.js", root), "utf8");
assert.match(host, /principalForSession/u);
assert.match(host, /DockerSecretKeyProvider/u);
const secretStore = await readFile(
  new URL("lib/secrets/secret-store.js", root),
  "utf8",
);
assert.match(secretStore, /aes-256-gcm/u);

console.log("built QA integrations package contract passed");
