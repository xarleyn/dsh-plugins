import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { verifyPluginCardContract } from "../../../scripts/verify-plugin-card-contract.mjs";

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
  "lib/tool-kit.js",
  "lib/client.js",
  "lib/typert.host.js",
  "lib/typert.host.d.ts",
  "lib/typert.remote-client.js",
  "lib/typert.remote-client.d.ts",
  "lib/types/index.d.ts",
  "lib/types/client/index.d.ts",
  "lib/providers/bitrix24/index.js",
  "lib/providers/bitrix24/catalog.js",
  "lib/providers/bitrix24/operations.js",
  "lib/providers/bitrix24/transport.js",
  "lib/providers/bitrix24/config.js",
  "lib/providers/bitrix24/tools.js",
  "lib/providers/confluence/index.js",
  "lib/providers/confluence/catalog.js",
  "lib/providers/confluence/operations.js",
  "lib/providers/confluence/transport.js",
  "lib/providers/confluence/config.js",
  "lib/providers/confluence/tools.js",
  "lib/providers/confluence/adf.js",
  "lib/providers/confluence/cql.js",
  "lib/providers/gitlab/index.js",
  "lib/providers/gitlab/catalog.js",
  "lib/providers/gitlab/operations.js",
  "lib/providers/gitlab/transport.js",
  "lib/providers/gitlab/config.js",
  "lib/providers/gitlab/tools.js",
  "lib/providers/teamcity/index.js",
  "lib/providers/teamcity/catalog.js",
  "lib/providers/teamcity/operations.js",
  "lib/providers/teamcity/transport.js",
  "lib/providers/teamcity/config.js",
  "lib/providers/teamcity/tools.js",
  "lib/providers/teamcity/artifacts.js",
  "lib/providers/teamcity/logs.js",
  "lib/providers/teamcity/network.js",
  "lib/providers/teamcity/locators.js",
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
assert.doesNotMatch(client, /localStorage|sessionStorage/u);
assert.doesNotMatch(client, /Показать токен|Копировать токен/u);
// The section renders the providers the host declares, so both cards are
// mounted from one bundle and neither ships its provider's catalog.
assert.match(client, /"bitrix24"/u);
assert.match(client, /"confluence"/u);
assert.match(client, /"gitlab"/u);
assert.match(client, /"teamcity"/u);
// The Confluence site is operator configuration too: the connect form picks one
// and asks for the account e-mail next to the secret, never for an address.
assert.match(client, /Почта аккаунта Atlassian/u);
assert.match(client, /Atlassian API token/u);
assert.match(client, /Оператор не настроил ни одного сайта Confluence/u);
assert.doesNotMatch(client, /atlassian\.net|api\.atlassian\.com/u);
// The TeamCity address is stand-wide configuration: the card sends the token
// alone, shows the address the Host resolved, and says so when there is none.
assert.doesNotMatch(client, /serverUrl/u);
assert.match(client, /задан оператором стенда/u);
assert.match(client, /Оператор не настроил адрес TeamCity/u);

// The card of "Plugin configuration": one bundle mounts both surfaces, and the
// key it claims has to be the namespace the Host serves, or the Host's tab
// never dispatches it.
verifyPluginCardContract(client);
assert.match(client, /"settings\.plugin\.item"/u);
assert.match(client, /"qa-integrations"/u);
assert.match(client, /Развернуть настройки интеграций/u);
assert.match(client, /Свернуть настройки интеграций/u);
// The browser has no module table for Node builtins: one `require("node:…")`
// left in the bundle is a card that never mounts.
for (const builtin of ["node:path", "node:fs", "node:os", "node:zlib"]) {
  assert.equal(
    client.includes(`require("${builtin}")`),
    false,
    `client bundle must not require ${builtin}`,
  );
}

// Design tokens are the host's vocabulary: a name it does not define is not a
// fallback but an invalid declaration, so the rule silently loses the property.
// `--dsw-alias-label-on-brand` cost the primary button its label that way, and
// the two state tokens printed its status and error colours as ordinary text.
assert.match(
  client,
  /__button--primary\{[^}]*color:var\(--dsw-alias-label-primary-foreground\)/u,
);
assert.doesNotMatch(client, /--dsw-alias-label-on-brand/u);
assert.match(
  client,
  /__status--ok\{color:var\(--dsw-alias-state-success-primary\)\}/u,
);
assert.match(
  client,
  /__button--danger\{color:var\(--dsw-alias-state-error-primary\)\}/u,
);
assert.doesNotMatch(client, /--dsw-alias-(success|error)-primary/u);

// Capability labels come from the provider at runtime, so the card renders a
// provider it has never heard of and the bundle stays free of the catalog.
const bitrixCatalog = await readFile(
  new URL("lib/providers/bitrix24/catalog.js", root),
  "utf8",
);
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
  assert.match(bitrixCatalog, new RegExp(label, "u"));
  assert.doesNotMatch(client, new RegExp(label, "u"));
}

const tools = await readFile(
  new URL("src/providers/bitrix24/tools.ts", root),
  "utf8",
);
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
  "bitrix_get_crm_requisites",
  "bitrix_get_call_transcript",
  "bitrix_get_current_user",
  "bitrix_search_users",
  "bitrix_get_departments",
  "bitrix_get_user_fields",
  "bitrix_search_chats",
  "bitrix_get_chat_messages",
  "bitrix_search_chat_messages",
  "bitrix_get_recent_chats",
  "bitrix_search_chat_users",
  "bitrix_find_chat",
  "bitrix_get_chat_participants",
  "bitrix_get_chat_user_data",
  "bitrix_get_openline_dialog",
  "bitrix_get_openline_history",
  "bitrix_search_tasks",
  "bitrix_get_task",
  "bitrix_get_task_history",
  "bitrix_get_task_results",
  "bitrix_get_task_elapsed_time",
  "bitrix_get_calendar_events",
  "bitrix_get_calendar_accessibility",
  "bitrix_search_files",
  "bitrix_get_file",
  "bitrix_get_drives",
  "bitrix_get_storage_items",
  "bitrix_get_folder_items",
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
const catalog = await readFile(
  new URL("src/providers/bitrix24/catalog.ts", root),
  "utf8",
);
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

// The GitLab provider follows the same shape: one directory, one catalog, one
// read-only operation per tool, and no way for the model to name a host.
const gitlabTools = await readFile(
  new URL("src/providers/gitlab/tools.ts", root),
  "utf8",
);
for (const name of [
  "gitlab_connection_get",
  "gitlab_projects_list",
  "gitlab_project_get",
  "gitlab_repository_tree",
  "gitlab_repository_file_get",
  "gitlab_commits_list",
  "gitlab_commit_get",
  "gitlab_compare",
  "gitlab_search",
  "gitlab_issues_list",
  "gitlab_issue_get",
  "gitlab_issue_notes_list",
  "gitlab_merge_requests_list",
  "gitlab_merge_request_get",
  "gitlab_merge_request_changes_get",
  "gitlab_merge_request_discussions_list",
  "gitlab_merge_request_approvals_get",
  "gitlab_merge_request_pipelines_list",
  "gitlab_pipelines_list",
  "gitlab_pipeline_get",
  "gitlab_pipeline_jobs_list",
  "gitlab_job_get",
  "gitlab_job_log_get",
]) {
  assert.match(gitlabTools, new RegExp(`name: "${name}"`, "u"));
}
for (const forbidden of [
  "userId:",
  "ownerUserId:",
  "credentialId:",
  "secretId:",
  "accessToken:",
  "refreshToken:",
  "instanceId:",
  "baseUrl:",
  "raw_api",
  "raw_graphql",
  "sudo",
]) {
  assert.doesNotMatch(gitlabTools, new RegExp(forbidden, "u"));
}

const gitlabCatalog = await readFile(
  new URL("src/providers/gitlab/catalog.ts", root),
  "utf8",
);
const gitlabPaths = [...gitlabCatalog.matchAll(/\bpath: "([^"]+)"/gu)].map(
  (match) => match[1],
);
const gitlabToolCount = [...gitlabTools.matchAll(/operation: "[^"]+"/gu)]
  .length;
assert.equal(
  gitlabPaths.length,
  gitlabToolCount,
  "every GitLab tool must name exactly one catalog operation",
);
assert.doesNotMatch(gitlabCatalog, /graphql|mutation/iu);
for (const path of gitlabPaths) {
  assert.match(path, /^\//u, `${path} must be an absolute API path`);
  assert.doesNotMatch(
    path,
    /repository\/files\/.+\/raw$|\/keys|\/hooks|\/members|\/variables|\/badges|\/runners|\/deploy_tokens|\/access_tokens|sudo/u,
    `${path} is not a read-only endpoint`,
  );
}
// Every GitLab operation is a GET; the only write-shaped surface left in the
// provider is the connect form, which never reaches a model tool.
assert.doesNotMatch(gitlabCatalog, /method: "(?:POST|PUT|PATCH|DELETE)"/u);
const gitlabTransport = await readFile(
  new URL("src/providers/gitlab/transport.ts", root),
  "utf8",
);
assert.match(gitlabTransport, /method: "GET"/u);
assert.match(gitlabTransport, /redirect: "error"/u);
assert.match(gitlabTransport, /"private-token": token/u);

// One directory per integration: the shared engine must not know any provider.
for (const file of [
  "src/broker.ts",
  "src/repository.ts",
  "src/types.ts",
  "src/tool-kit.ts",
  "src/coerce.ts",
  "src/secrets/secret-store.ts",
  "src/secrets/key-provider.ts",
  "src/providers/contract.ts",
  "src/providers/registry.ts",
]) {
  const source = await readFile(new URL(file, root), "utf8");
  assert.doesNotMatch(
    source,
    /bitrix|gitlab|teamcity|confluence/iu,
    `${file} must stay provider-agnostic`,
  );
}

// Capability labels come from the provider at runtime, so the card renders a
// provider it has never heard of and the bundle stays free of every catalog.
const gitlabCapabilityCatalog = await readFile(
  new URL("lib/providers/gitlab/catalog.js", root),
  "utf8",
);
for (const label of [
  "Читать проекты",
  "Читать репозитории",
  "Искать по GitLab",
  "Читать задачи",
  "Читать merge requests",
  "Читать CI/CD",
  "Свой профиль",
]) {
  assert.match(gitlabCapabilityCatalog, new RegExp(label, "u"));
  assert.doesNotMatch(client, new RegExp(label, "u"));
}

// The TeamCity provider has the same shape, with one extra rule: its server
// address is user input, so the catalog may not carry it and the address policy
// is re-checked on every call rather than only when the connection was stored.
const teamcityTools = await readFile(
  new URL("src/providers/teamcity/tools.ts", root),
  "utf8",
);
for (const name of [
  "teamcity_connection_get",
  "teamcity_projects",
  "teamcity_build_configs",
  "teamcity_builds",
  "teamcity_build",
  "teamcity_build_changes",
  "teamcity_build_failures",
  "teamcity_build_log",
  "teamcity_queue",
  "teamcity_investigations",
  "teamcity_agents",
  "teamcity_artifacts",
  "teamcity_artifact_text",
]) {
  assert.match(teamcityTools, new RegExp(`name: "${name}"`, "u"));
}
for (const forbidden of [
  "userId:",
  "ownerUserId:",
  "credentialId:",
  "secretId:",
  "accessToken:",
  "refreshToken:",
  "serverUrl:",
  "instanceId:",
  "locator:",
  "raw_rest",
]) {
  assert.doesNotMatch(teamcityTools, new RegExp(forbidden, "u"));
}

const teamcityCatalog = await readFile(
  new URL("src/providers/teamcity/catalog.ts", root),
  "utf8",
);
const teamcityPaths = [...teamcityCatalog.matchAll(/\bpath: "([^"]+)"/gu)].map(
  (match) => match[1],
);
const teamcityToolCount = [...teamcityTools.matchAll(/operation: "([^"]+)"/gu)]
  .length;
assert.equal(
  teamcityPaths.length,
  teamcityToolCount,
  "every TeamCity tool must name exactly one catalog operation",
);
assert.doesNotMatch(teamcityCatalog, /method: "(?:POST|PUT|PATCH|DELETE)"/u);
for (const path of teamcityPaths) {
  assert.match(path, /^\//u, `${path} must be an absolute API path`);
  assert.doesNotMatch(
    path,
    /\/(?:parameters|resulting-properties|tags|comment|pin|mutes)|vcs-roots|agents\/\d|investigations\/\d|users/u,
    `${path} is not a read-only endpoint`,
  );
}

const teamcityTransport = await readFile(
  new URL("src/providers/teamcity/transport.ts", root),
  "utf8",
);
assert.match(teamcityTransport, /method: "GET"/u);
assert.match(teamcityTransport, /redirect: "error"/u);
assert.match(teamcityTransport, /authorization: `Bearer \$\{token\}`/u);
const teamcityHost = await readFile(
  new URL("src/providers/teamcity/index.ts", root),
  "utf8",
);
// The address is operator configuration: it is canonicalized and policy-checked
// while the deployment's config is resolved, re-checked on every call, and never
// taken from whatever a connect form or a tool call supplied.
const teamcityConfig = await readFile(
  new URL("src/providers/teamcity/config.ts", root),
  "utf8",
);
assert.match(teamcityConfig, /resolveServerUrl/u);
assert.match(teamcityConfig, /serverUrlProblem/u);
assert.match(teamcityHost, /configuredServer/u);
assert.doesNotMatch(teamcityHost, /serverUrl:\s*input/u);
assert.match(teamcityHost, /sanitizeLog/u);
assert.match(teamcityHost, /artifactBinaryProblem/u);

// Capability labels come from the provider at runtime, so the card renders a
// provider it has never heard of and the bundle stays free of every catalog.
const teamcityCapabilityCatalog = await readFile(
  new URL("lib/providers/teamcity/catalog.js", root),
  "utf8",
);
for (const label of [
  "Читать сборки",
  "Читать лог сборки",
  "Читать причины падения",
  "Читать артефакты",
  "Читать очередь сборки",
  "Читать агентов",
]) {
  assert.match(teamcityCapabilityCatalog, new RegExp(label, "u"));
  assert.doesNotMatch(client, new RegExp(label, "u"));
}

// The Confluence provider is read-only over one documented API surface. Its
// paths live under `/wiki`, every one of them is a GET, and the retired v1
// content endpoints are gone from the catalog rather than merely unused.
const confluenceTools = await readFile(
  new URL("src/providers/confluence/tools.ts", root),
  "utf8",
);
for (const name of [
  "confluence_connection_get",
  "confluence_search",
  "confluence_get_page",
  "confluence_get_page_comments",
  "confluence_get_page_attachments",
  "confluence_get_page_versions",
  "confluence_get_space",
  "confluence_list_spaces",
]) {
  assert.match(confluenceTools, new RegExp(`name: "${name}"`, "u"));
}
for (const forbidden of [
  "userId:",
  "ownerUserId:",
  "credentialId:",
  "secretId:",
  "accessToken:",
  "refreshToken:",
  "instanceId:",
  "cloudId:",
  "siteAlias:",
  "baseUrl:",
  "email:",
  "raw_rest",
  "raw_api",
  "search_cql",
]) {
  assert.doesNotMatch(confluenceTools, new RegExp(forbidden, "u"));
}

const confluenceCatalog = await readFile(
  new URL("src/providers/confluence/catalog.ts", root),
  "utf8",
);
const confluencePaths = [
  ...confluenceCatalog.matchAll(/\bpath: "([^"]+)"/gu),
].map((match) => match[1]);
const confluenceToolCount = [
  ...confluenceTools.matchAll(/operation: "([^"]+)"/gu),
].length;
assert.equal(
  confluencePaths.length,
  confluenceToolCount,
  "every Confluence tool must name exactly one catalog operation",
);
assert.doesNotMatch(confluenceCatalog, /method: "(?:POST|PUT|PATCH|DELETE)"/u);
for (const path of confluencePaths) {
  assert.match(
    path,
    /^\/wiki\/(?:api\/v2|rest\/api)\//u,
    `${path} must be a wiki API path`,
  );
  assert.doesNotMatch(
    path,
    /\/rest\/api\/content|\/admin|properties|operations|likes|watchers|permissions|restrictions|blueprint|template/u,
    `${path} is not a read-only endpoint`,
  );
}

const confluenceTransport = await readFile(
  new URL("src/providers/confluence/transport.ts", root),
  "utf8",
);
assert.match(confluenceTransport, /method: "GET"/u);
assert.match(confluenceTransport, /redirect: "error"/u);
// The credential reaches the service as a Basic pair and nowhere else: no
// query parameter is ever built out of a token.
assert.match(confluenceTransport, /Basic \$\{pair\}/u);
assert.match(confluenceTransport, /toString\("base64"\)/u);
assert.doesNotMatch(confluenceTransport, /searchParams\.set\([^)]*token/u);

// The page's space is what the operator allowlist is written in, so the guard
// sits in the provider and answers a refusal of its own: a page outside the
// policy is denied, not silently trimmed out of a search result.
const confluenceHost = await readFile(
  new URL("src/providers/confluence/index.ts", root),
  "utf8",
);
assert.match(confluenceHost, /assertSpaceAllowed/u);
assert.match(confluenceHost, /OperationDeniedByPolicy/u);
assert.doesNotMatch(confluenceHost, /baseUrl:\s*input/u);
const confluenceConfig = await readFile(
  new URL("src/providers/confluence/config.ts", root),
  "utf8",
);
assert.match(confluenceConfig, /spaceAllowed/u);
assert.match(
  confluenceConfig,
  /maxBodyChars must be at least defaultBodyChars/u,
);
// The catalog builds CQL from typed fields, so no operation hands the model a
// way to send a query of its own.
assert.match(
  await readFile(new URL("src/providers/confluence/cql.ts", root), "utf8"),
  /export function buildCql/u,
);

// Capability labels come from the provider at runtime, so the card renders a
// provider it has never heard of and the bundle stays free of every catalog.
const confluenceCapabilityCatalog = await readFile(
  new URL("lib/providers/confluence/catalog.js", root),
  "utf8",
);
for (const label of [
  "Свой профиль",
  "Читать пространства",
  "Искать по Confluence",
  "Читать страницы",
  "Читать комментарии",
  "Читать вложения",
  "Читать версии страниц",
]) {
  assert.match(confluenceCapabilityCatalog, new RegExp(label, "u"));
  assert.doesNotMatch(client, new RegExp(label, "u"));
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
