/**
 * Package gate for @yadsh/dsh-preset-persona-editor (guidelines §4, §6.3).
 *
 * Validates the manifest, the canonical bundle patch, the compatibility
 * manifest, the packaged file list, and the built browser bundle without
 * hitting the network. The shared checks live in
 * @yadsh/dsh-plugin-scripts/run-verify-package.
 */
import assert from "node:assert/strict";
import { runVerifyPackage } from "@yadsh/dsh-plugin-scripts/run-verify-package";

await runVerifyPackage({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-preset-persona-editor",
  license: "MIT",
  enginesNodeMatchesCompatibility: true,
  // Exports: the host entry, the browser entry, both wire artifacts, the
  // shared DTO module, and the manifest every DSH surface reads.
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
      "@deepseek-ai/dsh-client-ui-renderer",
      "@deepseek-ai/dsh-client-ui-settings",
    ],
  },
  files: [
    "lib/**/*.js",
    "lib/**/*.js.map",
    "lib/**/*.d.ts",
    "cordis.patch.yml",
    "compatibility.json",
    "README.md",
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
  patch: { headerComment: true, id: "dsh-preset-persona-editor" },
  compatibility: {
    range: true,
    testedReleases: true,
    hostFeatures: ["service:agentPresets", "service:systemPrompt"],
    clientFeatures: ["settings.section", "typert.remote"],
  },
  clientBundle: {
    moduleLoaderId: true,
    matches: [
      // Browser bundle identity (AGENTS.md): the registration id is the full
      // package name, and the page names the preset composition file it edits.
      /id:\s*"@yadsh\/dsh-preset-persona-editor"/u,
      /agent\.cordis\.yml/u,
    ],
    notMatches: [
      // The browser half edits text; the YAML surgery and the file-system
      // writer stay host-side, so no node built-in may reach the bundle.
      /\brequire\(\s*["']node:/u,
      /\brequire\(\s*["']yaml["']\s*\)/u,
      /\bfrom\s*["']yaml["']/u,
    ],
    // The page reuses the canonical card shell for its preset rows (AGENTS.md
    // card contract). Opting into the contract keeps the shell CSS and the
    // chevron SVG honest through the bundler.
    cardContract: {},
  },
  extra: async ({ manifest, readFile }) => {
    // DSH runtime packages stay peer-only (SPEC.md §1). The YAML parser is a
    // host-side library, not a harness package, so it sits in dependencies.
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      assert.doesNotMatch(
        dependency,
        /^@deepseek-ai\//u,
        `harness package must stay a peer: ${dependency}`,
      );
    }
    // Harness packages and the browser runtime the host page already provides
    // are the only peers; anything else belongs in dependencies.
    const browserPeers = new Set(["react", "react-dom"]);
    for (const peer of Object.keys(manifest.peerDependencies)) {
      assert.ok(
        peer.startsWith("@deepseek-ai/") || browserPeers.has(peer),
        `unexpected peer: ${peer}`,
      );
    }

    // The host half must never mount or rewrite a preset it does not own: the
    // shipped presets are refused by trust, not by path spelling.
    const writer = await readFile("lib/host/preset-writer.js");
    assert.match(writer, /trust/u);
    assert.doesNotMatch(writer, /rm\(\s*preset\.path/u);

    // The spec's product contract stays a document with an honest status.
    const spec = await readFile("SPEC.md");
    assert.match(spec, /## 1\. Product contract/u);
    assert.match(spec, /## 6\. Implementation status/u);
  },
});
