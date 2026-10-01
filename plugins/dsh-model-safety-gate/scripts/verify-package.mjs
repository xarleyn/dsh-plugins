/**
 * Package gate for @yadsh/dsh-model-safety-gate (guidelines §4, §6.3).
 *
 * Validates the manifest, canonical bundle patch pair, compatibility
 * manifest, packaged file list, and the attribution contract without hitting
 * the network. The shared checks and the canonical card shell contract
 * (verify-plugin-card-contract) come from
 * @yadsh/dsh-plugin-scripts/run-verify-package.
 */
import assert from "node:assert/strict";
import { runVerifyPackage } from "@yadsh/dsh-plugin-scripts/run-verify-package";

await runVerifyPackage({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-model-safety-gate",
  license: "MIT",
  enginesNodeMatchesCompatibility: true,
  // Exports: exhaustive public surface, including the browser and wire entry points.
  exports: [
    ".",
    "./client",
    "./remote",
    "./typert",
    "./types",
    "./package.json",
  ],
  client: {
    platform: "web",
    injectEquals: [
      "@deepseek-ai/dsh-api-gateway",
      "@deepseek-ai/dsh-client-connection",
      "@deepseek-ai/dsh-client-ui-plugin-manager",
      "@deepseek-ai/dsh-client-ui-settings",
    ],
  },
  files: [
    "lib/**/*.js",
    "lib/**/*.js.map",
    "lib/**/*.d.ts",
    "lib/client.js",
    "cordis.patch.yml",
    "compatibility.json",
    "README.md",
    "NOTICE.md",
    "THIRD_PARTY_NOTICES.md",
    "LICENSE",
  ],
  requiredFiles: [
    "lib/index.js",
    "lib/types/index.d.ts",
    "lib/client.js",
    "lib/types/client/index.d.ts",
    "lib/typert.host.js",
    "lib/typert.host.d.ts",
    "lib/typert.remote-client.js",
    "lib/typert.remote-client.d.ts",
  ],
  patch: { headerComment: true, id: "dsh-model-safety-gate" },
  // Compatibility manifest (guidelines §7): the four guarded extension points.
  compatibility: {
    range: true,
    testedReleases: true,
    hostFeatures: [
      "agent/pre-step",
      "llm/stream",
      "tools/pre-execute",
      "tools/post-execute",
    ],
  },
  clientBundle: {
    moduleLoaderId: true,
    includes: [
      // The card mounts on the Plugins page, in the keyed seat of this bundle's
      // own row; the seat moved out of the Settings "Built-in plugins" section.
      "plugins.row.config",
      // That key is `<package name>#<row id>`, and the row id is the settings
      // namespace, so a value saved before the move keeps reading under it.
      "@yadsh/dsh-model-safety-gate#",
    ],
    matches: [
      // Browser bundle identity (AGENTS.md): the registration id is the full
      // package name.
      /id:\s*"@yadsh\/dsh-model-safety-gate"/u,
      // The card must not ship the classifier key: the wire projection is
      // redacted host-side, and the bundle itself never carries a literal key
      // field name pair.
      /apiKeyConfigured/u,
    ],
    notMatches: [
      // The old tab seat of the Plugins settings section must not come back:
      // one render site, or the card shows twice.
      /"settings\.plugins\.tab"/u,
    ],
    cardContract: {
      legacyPatterns: [
        /\.msg-gate-card\b/u,
        /\.msg-panel\b/u,
        /dsh-plugin-card\s*\*/u,
      ],
    },
  },
  extra: async ({ manifest, readFile }) => {
    // DSH runtime packages stay peer-only (SPEC.md §1, criterion 16). A third-party
    // runtime library (zod, used by the generated Remote codec) is allowed; a
    // harness package never is.
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      assert.doesNotMatch(
        dependency,
        /^@deepseek-ai\//,
        `harness package must stay a peer: ${dependency}`,
      );
    }
    // Harness packages and the browser runtime the host page already provides are
    // the only peers; anything else belongs in dependencies.
    const BROWSER_PEERS = new Set(["react", "react-dom"]);
    for (const peer of Object.keys(manifest.peerDependencies)) {
      assert.ok(
        peer.startsWith("@deepseek-ai/") || BROWSER_PEERS.has(peer),
        `unexpected peer: ${peer}`,
      );
    }

    // Since 0.1.7 the settings namespace of a configuration form is the profile
    // entry id, so the key the card binds and the row the patch declares are one
    // fact. A drift shows up as a card that renders no form, never as a compile
    // error. The `patch.id` option above pins the row to the literal below.
    const namespace = /SAFETY_GATE_SETTINGS_NAMESPACE\s*=\s*"([^"]+)"/u.exec(
      await readFile("src/shared/settings.ts"),
    )?.[1];
    assert.equal(
      namespace,
      "dsh-model-safety-gate",
      "the card's settings namespace must be the profile entry id",
    );

    // Attribution contract of the plugin (design SPEC §2).
    const readme = await readFile("README.md");
    assert.match(readme, /NOTICE\.md/);
    const notice = await readFile("NOTICE.md");
    for (const upstream of [
      "dsh-defend",
      "PerryLink",
      "dsh-run-guard",
      "dsh-autogate",
      "dsh-secure-audit",
      "dsh-injection-guard",
    ]) {
      assert.ok(
        notice.includes(upstream),
        `NOTICE.md is missing attribution: ${upstream}`,
      );
    }
    const thirdParty = await readFile("THIRD_PARTY_NOTICES.md");
    assert.match(thirdParty, /Apache-2\.0/);
    assert.match(thirdParty, /bundles no third-party source/);

    // Docs: SPEC.md product contract present and status table honest.
    const spec = await readFile("SPEC.md");
    assert.match(spec, /## 1\. Product contract/);
    assert.match(spec, /## 6\. Implementation status/);

    // The host service must not ship the session-event sink it read from.
    const host = await readFile("lib/service.js");
    assert.doesNotMatch(host, /KNOWN_SESSION_EVENT_TYPES/u);
    assert.doesNotMatch(host, /\.append\(["']safety-gate\//u);
    assert.match(host, /sessionId/u);
  },
});
