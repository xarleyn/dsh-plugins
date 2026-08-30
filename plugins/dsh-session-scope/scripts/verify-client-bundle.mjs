import { readFile } from "node:fs/promises";

const client = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");

const requiredFragments = [
  "id: '@yadsh/dsh-session-scope'",
  "slots.inject('conversation.input.left'",
  "data-session-scope-hero-mount",
  "button[aria-haspopup=\"menu\"]",
  "ReactDOM.createPortal(button, heroMount)",
  "id: 'session-scope'",
  "useProjection('session-scope')",
  "ctx.inject(['remote.sessionScope']",
  "scopeRemoteFace.list(sessionId, path)",
  "scope.capabilities",
  "sameRoots(effectiveRoots, currentRoots)",
  "rem.commands.execute(sessionId, line, [])",
  "exports.inject = ['slots', 'remote', 'remote.commands', 'sessions']",
];

for (const fragment of requiredFragments) {
  if (!client.includes(fragment)) {
    throw new Error(`client bundle is missing ${JSON.stringify(fragment)}`);
  }
}

if (/^\s*export\s/m.test(client)) {
  throw new Error("client bundle must remain a classic module-loader script without ESM exports");
}

if (client.includes("dsh-draft-sessions") || client.includes("draftSessions/")) {
  throw new Error("client bundle contains foreign draft-sessions code");
}

if (/\/scope (?:capabilities|show|list)/.test(client)) {
  throw new Error("client bundle must not use durable commands for scope reads");
}

const registrations = client.match(/id: '@yadsh\/dsh-session-scope'/g) ?? [];
if (registrations.length !== 1) {
  throw new Error(`expected one client factory registration, found ${registrations.length}`);
}
