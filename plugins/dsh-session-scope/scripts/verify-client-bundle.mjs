/**
 * Client-bundle gate for @yadsh/dsh-session-scope.
 *
 * The bundle is an artifact now: `tsdown` wraps `src/client.ts` in the shell's
 * classic `window.__ModuleLoader__` factory, so this gate reads the built file
 * and asserts the contract the shell sees — the registration id, the composer
 * seat it claims, the non-durable RPC read it uses. Fragments name calls and
 * literals rather than imported identifiers, because the bundler is free to
 * rename what the module imported (`react` is emitted as an interop namespace)
 * while the call shapes are the contract.
 *
 * Text alone cannot show that the factory still hands the shell a working
 * plugin, so the gate ends by running the built registration against a
 * ModuleLoader stub and checking the exports themselves.
 */
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

import { createModuleLoaderStub } from "@yadsh/dsh-test-kit";

const MODULE_ID = "@yadsh/dsh-session-scope";
/** What the client plugin declares for the shell to resolve before `apply`. */
const EXPECTED_INJECT = ["slots", "remote", "remote.commands", "sessions"];

const client = await readFile(
  new URL("../lib/client.js", import.meta.url),
  "utf8",
);

const requiredFragments = [
  "window.__ModuleLoader__.load({",
  "id: '@yadsh/dsh-session-scope'",
  "slots.inject('conversation.input.left'",
  "data-session-scope-hero-mount",
  'button[aria-haspopup="menu"]',
  "createPortal(button, heroMount)",
  "id: 'session-scope'",
  "useProjection('session-scope')",
  "ctx.inject(['remote.sessionScope']",
  "scopeRemoteFace.list(sessionId, path)",
  "scope.capabilities",
  "sameRoots(effectiveRoots, currentRoots)",
  "rem.commands.execute(sessionId, line, [])",
  "exports.apply = apply;",
];

// Quotation belongs to the bundler: it emits double quotes and escapes the
// inner ones, while the source may use either. Compare fragments and bundle in
// one canonical form.
const normalizedClient = client.replaceAll("'", '"').replaceAll('\\"', '"');

for (const fragment of requiredFragments) {
  if (!normalizedClient.includes(fragment.replaceAll("'", '"'))) {
    throw new Error(`client bundle is missing ${JSON.stringify(fragment)}`);
  }
}

// The injection list is the shell's service contract for this plugin, and the
// bundler hoists it into a local the factory exports at the end.
if (!/exports\.inject = inject;/u.test(client)) {
  throw new Error("client bundle must export the injection list");
}
if (
  !/inject = \[\s*"slots",\s*"remote",\s*"remote\.commands",\s*"sessions"\s*\]/su.test(
    normalizedClient,
  )
) {
  throw new Error(
    "client bundle must inject slots, remote, remote.commands and sessions",
  );
}

if (/^\s*export\s/m.test(client)) {
  throw new Error(
    "client bundle must remain a classic module-loader script without ESM exports",
  );
}

if (
  client.includes("dsh-draft-sessions") ||
  client.includes("draftSessions/")
) {
  throw new Error("client bundle contains foreign draft-sessions code");
}

if (/\/scope (?:capabilities|show|list)/.test(client)) {
  throw new Error(
    "client bundle must not use durable commands for scope reads",
  );
}

const registrations =
  client.match(/id: ["']@yadsh\/dsh-session-scope["']/g) ?? [];
if (registrations.length !== 1) {
  throw new Error(
    `expected one client factory registration, found ${registrations.length}`,
  );
}

// The text above proves the bundle is shaped right; running it proves the
// factory still hands the shell a working plugin.
const loader = createModuleLoaderStub();
runInNewContext(
  client,
  {
    window: loader.window,
    navigator: { language: "en" },
    console,
  },
  { filename: "client.js" },
);

if (loader.registrations.length !== 1) {
  throw new Error(
    `expected the bundle to register one module, registered ${loader.registrations.length}`,
  );
}
const registration = loader.registrations[0];
if (registration.id !== MODULE_ID) {
  throw new Error(
    `client bundle registered as ${JSON.stringify(registration.id)}, expected ${JSON.stringify(MODULE_ID)}`,
  );
}

const plugin = registration.factory((moduleName) => {
  if (moduleName === "react" || moduleName === "react-dom") return {};
  throw new Error(`client bundle required unexpected module ${moduleName}`);
});

if (typeof plugin?.apply !== "function") {
  throw new Error("client bundle factory must export an apply function");
}
if (JSON.stringify(plugin.inject) !== JSON.stringify(EXPECTED_INJECT)) {
  throw new Error(
    `client bundle must inject ${JSON.stringify(EXPECTED_INJECT)}, got ${JSON.stringify(plugin.inject)}`,
  );
}
