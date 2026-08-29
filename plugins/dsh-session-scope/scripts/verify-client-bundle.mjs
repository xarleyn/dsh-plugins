import { readFile } from "node:fs/promises";

const client = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");

const requiredFragments = [
  "id: 'dsh-session-scope'",
  "slots.inject('conversation.input.left'",
  "data-session-scope-hero-mount",
  "button[aria-haspopup=\"menu\"]",
  "ReactDOM.createPortal(button, heroMount)",
  "id: 'session-scope'",
  "useProjection('session-scope')",
  "rem.commands.execute(sessionId, line, [])",
  "exports.inject = ['slots', 'connection', 'remote', 'remote.commands', 'sessions']",
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

const registrations = client.match(/id: 'dsh-session-scope'/g) ?? [];
if (registrations.length !== 1) {
  throw new Error(`expected one client factory registration, found ${registrations.length}`);
}
