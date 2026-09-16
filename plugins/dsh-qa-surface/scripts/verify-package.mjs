import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import QaSurface, { name, resolveConfig } from "../lib/index.js";
import { verifyPluginCardContract } from "../../../scripts/verify-plugin-card-contract.mjs";

const root = new URL("../", import.meta.url);
const required = [
  "lib/index.js",
  "lib/secure-session.js",
  "lib/access/model.js",
  "lib/access/role-repository.js",
  "lib/access/capability-catalog.js",
  "lib/access/service.js",
  "lib/access/skill-metadata.js",
  "lib/enforcement/skill-policy.js",
  "lib/enforcement/tool-grants.js",
  "lib/host-route.js",
  "lib/navigation-marker.js",
  "lib/client.js",
  "lib/client.js.map",
  "lib/typert.host.js",
  "lib/typert.remote-client.js",
  "lib/typert.remote-client.d.ts",
  "lib/personal-skills/index.js",
  "lib/personal-skills/service.js",
  "lib/personal-skills/provider.js",
  "lib/personal-skills/skill-file.js",
  "lib/personal-skills/skill-format.js",
  "lib/types/index.d.ts",
  "lib/types/client/index.d.ts",
  "lib/client/panels/index.js",
  "lib/types/client/panels/index.d.ts",
  "lib/types/client/panels/contract.d.ts",
  "lib/client/settings-extensions/index.js",
  "lib/types/client/settings-extensions/index.d.ts",
  "lib/types/client/settings-extensions/contract.d.ts",
  "lib/types/client/settings-extensions/user-session.d.ts",
  "scripts/repair-session-events.mjs",
  "cordis.patch.yml",
  "compatibility.json",
  "capability-policy.json",
  "README.md",
  "LICENSE",
];

await Promise.all(
  required.map(async (path) => {
    const details = await stat(new URL(path, root));
    assert(details.isFile(), `${path} must be a file`);
  }),
);

assert.equal(name, "qa-surface");
assert.equal(QaSurface.name, "QaSurface");
assert.equal(resolveConfig().route.path, "/qa");

const manifest = JSON.parse(
  await readFile(new URL("package.json", root), "utf8"),
);
assert.equal(manifest.name, "@yadsh/dsh-qa-surface");
assert.equal(
  manifest.bin["qa-repair-sessions"],
  "./scripts/repair-session-events.mjs",
);
assert.equal(manifest.exports["./client"].default, "./lib/client.js");
assert.equal(
  manifest.exports["./client/panels"].default,
  "./lib/client/panels/index.js",
);
assert.equal(
  manifest.exports["./client/panels"].types,
  "./lib/types/client/panels/index.d.ts",
);
assert.equal(
  manifest.exports["./client/settings"].default,
  "./lib/client/settings-extensions/index.js",
);
assert.equal(
  manifest.exports["./client/settings"].types,
  "./lib/types/client/settings-extensions/index.d.ts",
);
assert.equal(
  manifest.exports["./remote"].default,
  "./lib/typert.remote-client.js",
);
assert.equal(manifest.exports["./typert"].default, "./lib/typert.host.js");
assert.equal(manifest.dsh.client.platform, "web");
assert.equal(manifest.peerDependencies["react-dom"], "^18.2.0");
assert(
  manifest.dsh.client.inject.includes("@deepseek-ai/dsh-client-ui-layout"),
);
assert(
  manifest.dsh.client.inject.includes(
    "@deepseek-ai/dsh-api-session-controller",
  ),
);
assert(
  manifest.dsh.client.inject.includes(
    "@deepseek-ai/dsh-client-ui-settings-plugins",
  ),
  "the settings card needs the plugin-cards tab in the client inject manifest",
);
assert(manifest.dsh.client.inject.includes("@deepseek-ai/dsh-agent-presets"));
assert(
  manifest.dsh.client.inject.includes("@deepseek-ai/dsh-client-file-upload"),
  "attached files stage through the upload service, so its bundle must arrive first",
);
assert(!manifest.dsh.client.inject.includes("@deepseek-ai/dsh-client-runtime"));
assert.equal(
  `/plugins/${manifest.name}/client.js`,
  "/plugins/@yadsh/dsh-qa-surface/client.js",
  "scoped client bundle URL must preserve the full package name",
);

const patch = await readFile(new URL("cordis.patch.yml", root), "utf8");
assert.match(patch, /id:\s*dsh-qa-surface/u);
assert.match(patch, /name:\s*"@yadsh\/dsh-qa-surface"/u);

const host = await readFile(new URL("lib/index.js", root), "utf8");
const admission = await readFile(
  new URL("lib/secure-session.js", root),
  "utf8",
);
const remote = await readFile(
  new URL("lib/typert.remote-client.js", root),
  "utf8",
);
const hostRoute = await readFile(new URL("lib/host-route.js", root), "utf8");
const navigationMarker = await readFile(
  new URL("lib/navigation-marker.js", root),
  "utf8",
);
// Skill routing: what a SKILL.md declares, and what it actually receives.
const skillMetadata = await readFile(
  new URL("lib/access/skill-metadata.js", root),
  "utf8",
);
const toolGrants = await readFile(
  new URL("lib/enforcement/tool-grants.js", root),
  "utf8",
);
const skillPolicy = await readFile(
  new URL("lib/enforcement/skill-policy.js", root),
  "utf8",
);
const provenanceHost = await readFile(
  new URL("lib/provenance/host-store.js", root),
  "utf8",
);
const provenanceStore = await readFile(
  new URL("lib/provenance/snapshot-store.js", root),
  "utf8",
);
const hostRuntime = `${host}\n${provenanceHost}\n${provenanceStore}`;
assert.match(host, /webServer/u);
assert.doesNotMatch(hostRuntime, /KNOWN_SESSION_EVENT_TYPES/u);
assert.doesNotMatch(hostRuntime, /\.append\(["']qa\/sources/u);
assert.match(hostRuntime, /qa-sources\.json/u);
assert.match(`${hostRoute}\n${navigationMarker}`, /__dsh_qa_route/u);
assert.doesNotMatch(`${host}\n${hostRoute}`, /registerFallback/u);
assert.match(admission, /permissionPresets\.set/u);
assert.match(admission, /agentPresets\.composedPreset/u);
assert.match(admission, /\.tools\.restrict/u);
assert.match(admission, /\.tools\.guard/u);
assert.match(admission, /qaToolPolicyPlan/u);
assert.match(admission, /allow:\s*policy\.allow/u);
assert.match(admission, /installQaSkillPolicy/u);
// The capability policy owns the scoped restriction, so activating a skill can
// widen the toolset; the guard reads the same live set.
assert.match(admission, /createGrants/u);
assert.match(admission, /effectiveTools\(\)/u);
assert.doesNotMatch(admission, /\.tools\.presentAs\("native"\)/u);
assert.match(admission, /existing non-QA session cannot be adopted/u);
assert.match(remote, /qaSurface\/secureSession/u);
assert.match(remote, /qaSurface\/describe/u);
for (const method of [
  "accessCurrent",
  "accessSession",
  "accessAdminSnapshot",
  "accessCreateSubrole",
  "accessUpdateSubrole",
  "accessDeleteSubrole",
  "accessUpdateCommon",
  "accessUpdateAssignment",
  "accessUpdateSkillOverride",
  "accessSkillActivations",
]) {
  assert.match(remote, new RegExp(`qaSurface/${method}`, "u"));
}
// Skill routing metadata is read from the skill file and never rewritten.
assert.match(skillMetadata, /"qa-surface"/u);
assert.match(skillMetadata, /unknown subrole/u);
assert.match(skillMetadata, /audience lists no known subrole/u);
assert.match(skillMetadata, /unsupported qa-surface metadata version/u);
assert.doesNotMatch(skillMetadata, /writeFileSync|SKILL\.md/u);
// A grant intersects the role ceiling and is reported when it cannot be given.
assert.match(toolGrants, /restrict\(\{ allow/u);
assert.match(toolGrants, /effectiveTools/u);
assert.match(toolGrants, /cannot be activated because required tool/u);
assert.match(toolGrants, /Unavailable required tools/u);
// No skill activation may be recorded as a custom session event: an unknown
// event type makes the session log unreadable for every consumer.
assert.doesNotMatch(
  `${toolGrants}\n${skillMetadata}`,
  /session\.append|\.append\(/u,
);
// Both activation paths — the model's `skill` call and a typed `/name` — end
// in the same grant, and the gesture listener must run outermost to still be
// able to withdraw an injection the standard consumer appended.
assert.match(skillPolicy, /agent\/pre-step/u);
assert.match(skillPolicy, /prepend:\s*true/u);
assert.match(skillPolicy, /skill-invocation/u);
assert.match(skillPolicy, /grants\.activate/u);
assert.match(skillPolicy, /SKILL_NOT_AVAILABLE/u);
// Personal skills ride the same namespace: the browser names a skill, and the
// account token behind the call decides which storage that name resolves in.
for (const method of [
  "skillsList",
  "skillsGet",
  "skillsCreate",
  "skillsUpdate",
  "skillsRemove",
  "skillsTools",
  "skillsValidate",
]) {
  assert.match(remote, new RegExp(`qaSurface/${method}`, "u"));
}
// The provider itself lives in its own module: the Host service registers it
// through `ctx.inject`, so the entry only wires it.
const skillsHost = await readFile(
  new URL("lib/personal-skills/host.js", root),
  "utf8",
);
const skillsProvider = await readFile(
  new URL("lib/personal-skills/provider.js", root),
  "utf8",
);
const skillsService = await readFile(
  new URL("lib/personal-skills/service.js", root),
  "utf8",
);
const skillsFile = await readFile(
  new URL("lib/personal-skills/skill-file.js", root),
  "utf8",
);
assert.match(skillsHost, /registerProvider/u);
assert.match(skillsHost, /\.inject\(\["skills"\]/u);
assert.match(skillsProvider, /qa-user-skills/u);
assert.match(skillsProvider, /kind:\s*"directory"/u);
// Storage boundary: the account's own directory, a rename-based write, and a
// revision the caller has to echo back.
assert.match(skillsService, /prepareQaUserWorkspace/u);
assert.match(skillsService, /renameSync/u);
assert.match(skillsService, /skill-conflict/u);
assert.match(skillsService, /skills-trash|\.trash/u);
assert.match(skillsFile, /disable-model-invocation/u);
assert.match(skillsFile, /allowed-tools/u);
assert.doesNotMatch(skillsFile, /require\(/u);

const repair = await readFile(
  new URL("scripts/repair-session-events.mjs", root),
  "utf8",
);
assert.match(repair, /safety-gate\/warn/u);
assert.match(repair, /qa\/sources/u);
assert.match(repair, /ignorable/u);
assert.match(repair, /pre-plugin-event-repair\.bak/u);

const client = await readFile(new URL("lib/client.js", root), "utf8");
const escapedVersion = manifest.version.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
assert.match(
  client,
  /__ModuleLoader__\.load\(\{\s*id:\s*"@yadsh\/dsh-qa-surface"/u,
);
assert.match(
  client,
  new RegExp(`const QA_VERSION = "${escapedVersion}"`, "u"),
  "client bundle must embed the package version",
);
assert.doesNotMatch(client, /__DSH_QA_VERSION__/u);
assert.match(client, /shell\.overlay/u);
assert.match(client, /qaSurfacePanels/u);
assert.match(client, /qa\.surface\.panel/u);
assert.match(client, /dsh-qa-extension-panel/u);
assert.match(client, /dsh-qa-panel-launcher/u);
assert.doesNotMatch(client, /playwright|BrowserPanel|browser process/u);
assert.match(client, /id:\s*"dsh-qa-surface"/u);
assert.match(client, /settings\.onboarding/u);
assert.match(client, /"welcome-notice"/u);
assert.match(client, /priority:\s*-1e3|priority:\s*-1000/u);
assert.match(client, /Перед началом тестирования/u);
assert.match(client, /2026-09-12\.1/u);
assert.match(client, /dsh-qa-onboarding/u);
assert.match(client, /require\("react-dom"\)/u);
assert.match(client, /\.prompt\(/u);
assert.match(client, /\.cancel\(/u);
assert.match(client, /\.create\(/u);
assert.match(client, /secureSession/u);
assert.match(client, /\/qa\/admin/u);
assert.match(client, /dsh-qa-role-selector/u);
assert.match(client, /dsh-qa-admin-preview/u);
assert.match(client, /Общие возможности/u);
assert.match(client, /Фактический доступ/u);
assert.match(client, /Всегда доступны/u);
assert.match(client, /Доступны через навыки/u);
assert.match(client, /Объявлено навыком/u);
assert.match(client, /accessUpdateSkillOverride/u);
assert.match(client, /accessSkillActivations/u);
assert.match(client, /Заблокирован/u);
assert.match(client, /Настройки помощника недоступны\./u);
assert.match(client, /dsh-qa-surface:v1|:v1:/u);
assert.match(client, /dsh-qa-sidebar/u);
assert.match(client, /dsh-qa-width-handle/u);
assert.match(client, /:content-width/u);
assert.match(client, /История чатов/u);
assert.match(client, /policy attestation failed \(reason:/u);
assert.match(client, /data-dsh-qa-surface|dshQaSurface/u);
assert.match(client, /position:fixed;inset:0/u);
assert.match(client, /--dsw-specific-bubble/u);
assert.match(client, /--dsw-specific-input-major/u);
assert.match(client, /--dsh-qa-bleed/u);
assert.match(client, /--dsh-qa-brand/u);
assert.match(client, /#3D9E9A/u);
assert.match(client, /--dsh-qa-accent-contrast/u);
assert.match(client, /TTFT/u);
assert.match(client, /dsh-qa-message__meta/u);
assert.match(client, /Нравится/u);
assert.match(client, /dsh-qa-variants/u);
assert.match(client, /Перегенерируй/u);
assert.match(client, /dsh-qa-sources/u);
assert.match(client, /Источники/u);
assert.match(client, /dsh-qa-panel__tab/u);
assert.match(client, /dsh-qa-sourcespanel/u);
assert.match(client, /Все источники/u);
assert.match(client, /dsh-qa-files__items/u);
assert.match(client, /Файлы/u);
assert.match(client, /В этом чате нет вложений\./u);
assert.match(client, /dsh-qa-composer__images/u);
assert.match(client, /dsh-qa-message__images/u);
assert.match(client, /dsh-qa-composer__files/u);
assert.match(client, /dsh-qa-message__files/u);
assert.match(client, /dsh-qa-file__badge/u);
assert.match(client, /Прикрепить файл/u);
assert.match(client, /Вставленный текст/u);
assert.match(client, /Вложения недоступны на этом сервере\./u);
assert.match(client, /"fileUpload"|fileUpload/u);
assert.match(client, /mediaType/u);
assert.match(client, /dsh-qa-sourcedetail/u);
assert.match(client, /Открыть/u);
assert.match(client, /dsh-qa-footer__disclaimer/u);
assert.match(client, /используются для улучшения качества ответов/u);
assert.match(client, /Субагент/u);
assert.match(client, /dsh-qa-agents/u);
assert.match(client, /dsh-qa-agentview/u);
assert.match(client, /started subagent/u);
assert.match(client, /Скопировать сообщение/u);
assert.match(client, /Enter: отправить/u);
assert.match(client, /Скребу по сусекам/u);
assert.match(client, /dsh-qa-quick-questions/u);
assert.doesNotMatch(client, /@deepseek-ai\/schemastery/u);
assert.doesNotMatch(client, /dangerouslySetInnerHTML/u);
assert.doesNotMatch(client, /chat\/completions|api\.openai\.com/u);
assert.doesNotMatch(client, /toolResult\.content/u);
assert.doesNotMatch(client, /\.command\(/u);
assert.doesNotMatch(client, /\.rename\(/u);
assert.doesNotMatch(client, /sessions\.delete|deleteSession/u);
// The DSH module loader has no Node builtins and no YAML: the browser half of
// the skill format must stay free of both, or the whole surface fails to
// mount the moment a dependency reaches for `process`.
for (const builtin of ["process", "buffer", "node:fs", "node:path"]) {
  for (const quote of ['"', "'"]) {
    assert(
      !client.includes(`require(${quote}${builtin}${quote})`),
      `client bundle must not require ${builtin}`,
    );
  }
}
assert.doesNotMatch(client, /node_modules\/yaml/u, "yaml stays on the Host");

// The settings card (AGENTS.md shell contract): the canonical shell rules and
// chevron path, the keyed `settings.plugin.item` registration under the
// namespace the Host serves, and the plugin's own body classes.
verifyPluginCardContract(client, {
  legacyPatterns: [/dsh-plugin-card\s*\*/u, /\.qa-panel\b/u],
});
assert.match(client, /settings\.plugin\.item/u);
assert.match(client, /Помощник QA/u);
// The toggle's accessible label is assembled from the open state and the card
// name, so the bundle carries the two halves rather than one sentence.
assert.match(client, /Скрыть/u);
assert.match(client, /настройки: Помощник QA/u);
assert.match(client, /qa-card-body/u);
assert.match(client, /qa-card-notice/u);
// The sources section carries the reported-source validation switch, so a
// deployment can test a provider that reports facts instead of documents.
assert.match(client, /Проверять источники из отчёта/u);
assert.match(client, /registerSettingsCard|slots\.register/u);

// The settings dialog: one shell for the profile, the general page and the
// skills editor, with the legacy profile classes gone.
assert.match(client, /dsh-qa-modal__panel--settings/u);
assert.match(client, /dsh-qa-settings__nav/u);
assert.match(client, /role:\s*"tablist"|"tablist"/u);
assert.match(client, /Открыть настройки/u);
assert.doesNotMatch(client, /dsh-qa-profile/u);
assert.doesNotMatch(client, /Открыть профиль/u);
assert.match(client, /У вас пока нет навыков\./u);
assert.match(client, /Принести первый навык|Создать первый навык/u);
assert.match(client, /dsh-qa-settings__row-button/u);
assert.match(client, /dsh-qa-toolpicker/u);
assert.match(client, /Недоступные в этой конфигурации/u);
assert.match(
  client,
  /Они не предоставляют дополнительных разрешений\./u,
  "the tool list must state that it grants nothing",
);
assert.match(client, /Предпросмотр SKILL\.md/u);
assert.match(client, /disable-model-invocation|whenToUse/u);
assert.match(client, /Перезагрузить текущую версию/u);
assert.match(client, /Его можно будет восстановить вручную из корзины\./u);
assert.match(client, /Сохраняемые поля frontmatter/u);
assert.match(client, /dsh-qa-settings__code/u);

const capabilityPolicy = JSON.parse(
  await readFile(new URL("capability-policy.json", root), "utf8"),
);
assert.equal(capabilityPolicy.version, 1);
assert.deepEqual(
  capabilityPolicy.tools.map((entry) => entry.name),
  resolveConfig().lockdown.toolPolicy.allow,
  "every default allow-listed tool must have a reviewed capability entry",
);

console.log("verify-package: all gates passed");
