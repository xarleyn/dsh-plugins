import { defineConfig, type UserConfig } from "tsdown";

const CLIENT_MODULE_ID = "@yadsh/dsh-doc-impact";
const CLIENT_EXTERNALS = ["react"];

const client = {
  name: "dsh-doc-impact/client",
  entry: { client: "src/client.ts" },
  outDir: "lib",
  format: ["cjs"],
  platform: "browser",
  target: "es2022",
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: CLIENT_EXTERNALS,
    alwaysBundle: (id: string) => !CLIENT_EXTERNALS.includes(id),
  },
  outputOptions: {
    entryFileNames: "client.js",
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(CLIENT_MODULE_ID)}, factory: (require) => {`,
    intro: "var module = { exports: {} }; var exports = module.exports;",
    footer: "return module.exports; } });",
  },
} satisfies UserConfig;

export default defineConfig(client);
