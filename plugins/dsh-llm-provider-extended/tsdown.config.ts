import { defineConfig, type UserConfig } from "tsdown";

const CLIENT_EXTERNALS = [
  "@deepseek-ai/cordis",
  "react",
  "react/jsx-runtime",
  "react-dom",
  "@deepseek-ai/dsh-client-ui-slots",
];

const client = {
  name: "@yadsh/dsh-llm-provider-extended/client",
  entry: { client: "src/client/index.tsx" },
  outDir: "lib",
  format: ["cjs"],
  platform: "browser",
  target: "es2022",
  dts: false,
  sourcemap: true,
  clean: false,
  codeSplitting: false,
  deps: {
    neverBundle: CLIENT_EXTERNALS,
    alwaysBundle: (id: string) => !CLIENT_EXTERNALS.includes(id),
  },
  outputOptions: {
    entryFileNames: "client.js",
    banner:
      'window.__ModuleLoader__.load({ id: "@yadsh/dsh-llm-provider-extended", factory: (require) => {',
    intro: "var module = { exports: {} }; var exports = module.exports;",
    footer: "return module.exports; } });",
  },
} satisfies UserConfig;

export default defineConfig(client);
