import { defineConfig, type UserConfig } from "tsdown";

const ID = "dsh-sleev";
const CLIENT_EXTERNALS = [
  "@deepseek-ai/cordis",
  "@deepseek-ai/dsh-client-locale/client",
  "@deepseek-ai/dsh-client-runtime/client",
  "@deepseek-ai/dsh-client-ui-settings/client",
  "@deepseek-ai/dsh-client-ui-settings-plugins/client",
  "@deepseek-ai/dsh-client-ui-slots",
  "react",
  "react/jsx-runtime",
];

const configs = [
  {
    name: ID,
    entry: {
      index: "src/index.ts",
      "shared/telemetry": "src/shared/telemetry.ts",
      "host/optimizer/sleev/headers": "src/host/optimizer/sleev/headers.ts",
    },
    outDir: "lib",
    format: ["esm"],
    platform: "node",
    target: "es2022",
    fixedExtension: false,
    dts: false,
    clean: true,
  },
  {
    name: `${ID}/client`,
    entry: { client: "src/client/index.tsx" },
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
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
      footer: "return module.exports; } });",
      intro: "var module = { exports: {} }; var exports = module.exports;",
    },
  },
] satisfies UserConfig[];

export default defineConfig(configs);
