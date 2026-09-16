import { defineConfig, type UserConfig } from "tsdown";

const PACKAGE_NAME = "@yadsh/dsh-qa-browser";
const CLIENT_EXTERNALS = [
  "@deepseek-ai/cordis",
  "@deepseek-ai/dsh-api-gateway/client",
  "@deepseek-ai/dsh-api-session-controller/remote-events",
  "@deepseek-ai/dsh-client-ui-renderer/client",
  "@deepseek-ai/dsh-client-ui-slots",
  "@deepseek-ai/dsh-typert-protocol",
  "react",
  "react-dom",
  "react/jsx-runtime",
];

const client: UserConfig = {
  name: "dsh-qa-browser/client",
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
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_NAME)}, factory: (require) => {`,
    intro: "var module = { exports: {} }; var exports = module.exports;",
    footer: "return module.exports; } });",
  },
};

export default defineConfig([client]);
