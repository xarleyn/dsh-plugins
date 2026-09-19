import type { UserConfig } from "tsdown";

/**
 * Browser bundle of the settings card. The registration id must be the full
 * package name (AGENTS.md: module identity), and React stays external because
 * the host page already provides it.
 */
const client: UserConfig = {
  name: "@yadsh/dsh-openviking-memory/client",
  entry: { client: "src/client/index.tsx" },
  outDir: "lib",
  format: ["cjs"],
  platform: "browser",
  target: "es2024",
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: (specifier) =>
      specifier === "react" || specifier === "react/jsx-runtime",
    alwaysBundle: (specifier) =>
      specifier !== "react" && specifier !== "react/jsx-runtime",
  },
  outputOptions: {
    entryFileNames: "client.js",
    sourcemapExcludeSources: false,
    banner:
      'window.__ModuleLoader__.load({ id: "@yadsh/dsh-openviking-memory", factory: (require) => {',
    intro: "var module = { exports: {} }; var exports = module.exports;",
    footer: "return module.exports; } });",
  },
};

export default [client];
