import { defineConfig, type UserConfig } from "tsdown";

const ID = "dsh-ui-repair";
const CLIENT_MODULE_ID = "@yadsh/dsh-ui-repair";
const CLIENT_EXTERNALS = ["@deepseek-ai/cordis"];

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
    clean: false,
  },
  {
    name: `${ID}/client`,
    entry: { client: "src/client/index.ts" },
    outDir: "lib",
    format: ["cjs"],
    platform: "browser",
    target: "es2024",
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: CLIENT_EXTERNALS,
      alwaysBundle: (specifier: string) =>
        !CLIENT_EXTERNALS.includes(specifier),
    },
    outputOptions: {
      entryFileNames: "client.js",
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(CLIENT_MODULE_ID)}, factory: (require) => {`,
      intro: "var module = { exports: {} }; var exports = module.exports;",
      footer: "return module.exports; } });",
    },
  },
] satisfies UserConfig[];

export default defineConfig(configs);
