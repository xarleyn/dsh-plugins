import assert from "node:assert/strict";
import { runVerifyPackage } from "@yadsh/dsh-plugin-scripts/run-verify-package";
import SessionAuditService, { Config, resolveConfig } from "../lib/index.js";

await runVerifyPackage({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-session-audit",
  requiredFiles: [
    "lib/index.js",
    "lib/client.js",
    "lib/types/index.d.ts",
    "lib/typert.host.js",
    "lib/typert.host.d.ts",
    "lib/typert.remote-client.js",
    "lib/typert.remote-client.d.ts",
    "cordis.patch.yml",
  ],
  patch: { id: "dsh-session-audit" },
  exportDefaults: {
    "./client": "./lib/client.js",
    "./remote": "./lib/typert.remote-client.js",
    "./typert": "./lib/typert.host.js",
  },
  client: {
    platform: "web",
    injectIncludes: ["@deepseek-ai/dsh-client-ui-conversation"],
  },
  compatibility: {
    hostFeatures: ["sessionQuery/listSessions"],
    clientFeatures: ["conversation.view"],
  },
  clientBundle: {
    moduleLoaderId: true,
    includes: [
      // The view registers into the conversation strip, by the id the tab
      // shows and the order that puts it after Chat and Trajectory.
      'name: "conversation.view"',
      'AUDIT_VIEW_ID = "audit"',
      'AUDIT_VIEW_LABEL = "Audit"',
      "order: 20",
      // Content components travel with the bundle.
      "dsh-audit-status__verdict",
      "dsh-audit-findings",
      "dsh-audit-json__tree",
      "dsh-audit-md__table",
      "dsh-audit-page__body",
    ],
    notMatches: [
      // A Node builtin in a browser bundle is a load error, not a fallback.
      /require\(["']node:/u,
      // The report renderer must have no HTML path at all.
      /dangerouslySetInnerHTML/u,
      // The audit root is never spelled as a QA directory.
      /qa-surface/u,
    ],
  },
  extra: async ({ manifest, client, readFile }) => {
    assert.equal(
      manifest.dsh.client.inject.includes(
        "@deepseek-ai/dsh-client-ui-renderer",
      ),
      true,
      "the client needs the renderer package for the slots service augmentation",
    );

    // Glyph check, scoped to this plugin's own sources: bundled third-party
    // code (zod) carries its own characters, and a whole-bundle match would
    // only ever report on those.
    for (const file of [
      "src/client/index.tsx",
      "src/client/AuditPage.tsx",
      "src/client/styles.ts",
    ]) {
      const source = await readFile(file);
      assert.doesNotMatch(
        source,
        /[⌄▾▸]/u,
        `${file} must use an SVG chevron, not a font glyph`,
      );
    }
    assert.match(
      await readFile("src/client/AuditPage.tsx"),
      /dsh-audit-json|AuditJsonTree/u,
      "the Audit view must render the JSON tree",
    );

    // The host service must be discoverable by name: a consumer reads it
    // through the optional-service accessor, so the key is the contract.
    assert.equal(
      typeof SessionAuditService,
      "function",
      "the host entry must default-export the service class",
    );
    assert.equal(
      SessionAuditService.Config,
      Config,
      "the service must carry the Schemastery schema",
    );
    assert.equal(
      SessionAuditService.prototype.summary !== undefined &&
        SessionAuditService.prototype.audit !== undefined,
      true,
      "the service must expose the SPEC §31 summary and audit methods",
    );

    // The audit root never defaults to a QA-specific path (SPEC §12).
    const root = resolveConfig({}, { DSH_HOME: "/home/demo" }).auditRoot;
    assert.equal(
      root.endsWith("audits"),
      true,
      `the default audit root must live under $DSH_HOME/audits, got ${root}`,
    );
    assert.equal(
      root.includes("qa"),
      false,
      "the canonical audit root must not mention the QA surface",
    );

    const config = await readFile("lib/config.js");
    assert.match(
      config,
      /DSH_AUDIT_ROOT/u,
      "the environment override must ship in the host config module",
    );

    assert.match(
      client,
      /ModuleLoader__\.load\(\{\s*id:\s*"@yadsh\/dsh-session-audit"/u,
      "the client bundle must register the full scoped package name",
    );
  },
});
