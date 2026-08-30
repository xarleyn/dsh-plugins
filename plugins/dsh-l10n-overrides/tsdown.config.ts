import { defineConfig, type UserConfig } from "tsdown";

const ID = "dsh-l10n-overrides";
const CLIENT_MODULE_ID = "@yadsh/dsh-l10n-overrides";
const CLIENT_EXTERNALS = [
  "@deepseek-ai/cordis",
  "@deepseek-ai/dsh-client-locale/client",
];

const configs = [
  {
    name: ID,
    entry: { index: "src/index.ts" },
    outDir: "lib",
    format: ["esm"],
    platform: "node",
    target: "es2024",
    fixedExtension: false,
    dts: false,
    clean: true,
  },
  {
    name: `${ID}/client`,
    entry: { client: "src/client/index.ts" },
    outDir: "lib",
    format: ["cjs"],
    platform: "browser",
    target: "es2024",
    dts: false,
    sourcemap: false,
    clean: false,
    deps: {
      neverBundle: CLIENT_EXTERNALS,
      alwaysBundle: (id: string) => !CLIENT_EXTERNALS.includes(id),
    },
    outputOptions: {
      entryFileNames: "client.js",
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(CLIENT_MODULE_ID)}, factory: (require) => {`,
      footer: "return module.exports; } });",
      intro: "var module = { exports: {} }; var exports = module.exports;",
    },
  },
] satisfies UserConfig[];

export default defineConfig(configs);
