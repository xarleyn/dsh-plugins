/**
 * Package gate for @yadsh/dsh-qa-browser.
 *
 * The manifest, patch, export, file and bundle-registration checks come from
 * @yadsh/dsh-plugin-scripts/run-verify-package. What is left below is what only
 * this package can promise: the tool inventory the host registers, the defaults
 * the runtime reads, and the panel seats the chrome mounts.
 */
import assert from "node:assert/strict";

import { runVerifyPackage } from "@yadsh/dsh-plugin-scripts/run-verify-package";

await runVerifyPackage({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-qa-browser",
  license: "MIT",
  exports: [".", "./client", "./remote", "./types", "./package.json"],
  exportDefaults: {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./remote": "./lib/remote.js",
    "./types": "./lib/types.js",
  },
  exportsBuilt: true,
  client: {
    platform: "web",
    injectEquals: [
      "@deepseek-ai/dsh-api-gateway",
      "@deepseek-ai/dsh-api-session-controller",
      "@deepseek-ai/dsh-client-ui-slots",
      "@yadsh/dsh-qa-surface",
    ],
  },
  files: [
    "lib",
    "cordis.patch.yml",
    "compatibility.json",
    "README.md",
    "LICENSE",
  ],
  requiredFiles: [
    "lib/index.js",
    "lib/index.d.ts",
    "lib/client.js",
    "lib/client/index.d.ts",
    "lib/remote.js",
    "lib/remote.d.ts",
    "lib/types.js",
    "lib/types.d.ts",
    "README.md",
    "docs/DOCKER.md",
    "LICENSE",
  ],
  patch: { id: "dsh-qa-browser", name: "@yadsh/dsh-qa-browser" },
  compatibility: {
    range: true,
    testedReleases: true,
    node: "matchesEngines",
  },
  clientBundle: {
    moduleLoaderId: true,
    matches: [/qa\.surface\.panel/u],
    // The chrome's own seats and calls: a rename here is a panel that ships
    // without part of its browser, which is exactly what a built bundle can
    // prove.
    includes: [
      "dsh-qa-browser-panel__stage",
      "dsh-qa-browser-panel__canvas",
      "dsh-qa-browser-panel__tab-close",
      "dsh-qa-browser-panel__newtab",
      "panelTakeControl",
      "panelControlHeartbeat",
      "panelReleaseControl",
      "panelNewTab",
      "panelCloseTab",
      "panelHistory",
      "panelViewport",
      "api-session/status",
    ],
    // The panel embeds no frame of its own: the browser it drives is the
    // session's, reached through the gateway.
    notMatches: [/<iframe|createElement\("iframe"\)/iu],
  },
  extra: async ({ manifest }) => {
    // Installation is a plain pnpm step in DSH, never a package hook.
    assert.equal(manifest.scripts?.postinstall, undefined);
    assert.equal(manifest.dependencies?.playwright, "catalog:tooling");

    const built = await import(new URL("../lib/index.js", import.meta.url));
    assert.equal(built.name, "dsh-qa-browser");
    assert.equal(built.default, built.QaBrowserService);
    assert.equal(built.QA_BROWSER_DEFAULTS.runtime.provider, "playwright");
    assert.deepEqual(built.BROWSER_CORE_TOOL_NAMES, [
      "browser_navigate",
      "browser_snapshot",
      "browser_click",
      "browser_type",
      "browser_fill_form",
      "browser_select",
      "browser_press",
      "browser_hover",
      "browser_scroll",
      "browser_wait",
      "browser_tabs",
      "browser_viewport",
      "browser_history",
    ]);
    assert.deepEqual(built.BROWSER_VISION_TOOL_NAMES, ["browser_screenshot"]);
    assert.deepEqual(built.QA_BROWSER_DEFAULTS.humanControl, {
      enabled: true,
      leaseSeconds: 30,
      leaseMs: 30_000,
    });
  },
});
