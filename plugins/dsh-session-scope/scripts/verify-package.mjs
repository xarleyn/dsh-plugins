/**
 * Package gate for @yadsh/dsh-session-scope.
 *
 * The shared manifest/patch/client checks come from
 * @yadsh/dsh-plugin-scripts/run-verify-package; the publishing metadata and
 * the client-composition contract stay local.
 */
import { access } from "node:fs/promises";
import { runVerifyPackage } from "@yadsh/dsh-plugin-scripts/run-verify-package";

await runVerifyPackage({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-session-scope",
  versionPattern: /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u,
  exportDefaults: { "./client": "./lib/client.js" },
  client: { injectIncludes: ["@deepseek-ai/dsh-api-gateway"] },
  files: [
    "lib",
    "cordis.patch.yml",
    "compatibility.json",
    "README.md",
    "LICENSE",
  ],
  patch: { id: "dsh-session-scope" },
  extra: async ({ packageRoot, manifest, patch }) => {
    if (manifest.author !== "xarleyn") {
      throw new Error(
        `unexpected package author ${JSON.stringify(manifest.author)}`,
      );
    }
    if (
      manifest.publishConfig?.access !== "public" ||
      manifest.publishConfig?.registry !== "https://registry.npmjs.org/"
    ) {
      throw new Error("package publishing must target the public npm registry");
    }
    if (
      manifest.repository?.type !== "git" ||
      manifest.repository?.url !==
        "git+https://github.com/xarleyn/dsh-plugins.git" ||
      manifest.repository?.directory !== "plugins/dsh-session-scope"
    ) {
      throw new Error(
        "package repository must identify its canonical monorepo directory",
      );
    }

    for (const [subpath, descriptor] of Object.entries(
      manifest.exports ?? {},
    )) {
      if (subpath === "./package.json") continue;
      for (const field of ["types", "import"]) {
        const target = descriptor?.[field];
        if (typeof target !== "string") {
          throw new Error(`${subpath} has no ${field} export`);
        }
        await access(new URL(target.replace(/^\.\//, ""), packageRoot));
      }
    }
    for (const dependency of [
      "@deepseek-ai/cordis",
      "@deepseek-ai/dsh-typert-protocol",
    ]) {
      if (manifest.peerDependencies?.[dependency] !== "catalog:dsh") {
        throw new Error(`package must declare ${dependency} as a DSH peer`);
      }
    }

    if (
      /dsh-draft-sessions|draftSessions\//.test(
        JSON.stringify(manifest) + patch,
      )
    ) {
      throw new Error(
        "package metadata contains foreign draft-sessions identifiers",
      );
    }
  },
});
