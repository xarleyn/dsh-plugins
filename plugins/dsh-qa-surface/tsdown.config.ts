import { readFileSync } from "node:fs";
import type { UserConfig } from "tsdown";

const PACKAGE_NAME = "@yadsh/dsh-qa-surface";
const PACKAGE_VERSION = (
  JSON.parse(
    readFileSync(new URL("./package.json", import.meta.url), "utf8"),
  ) as { version: string }
).version;

const client: UserConfig = {
  name: "dsh-qa-surface/client",
  entry: { client: "src/client/index.tsx" },
  outDir: "lib",
  format: ["cjs"],
  platform: "browser",
  target: "es2022",
  dts: false,
  sourcemap: true,
  clean: false,
  define: {
    __DSH_QA_VERSION__: JSON.stringify(PACKAGE_VERSION),
  },
  deps: {
    neverBundle: (specifier) =>
      specifier === "react" ||
      specifier === "react-dom" ||
      specifier === "react/jsx-runtime",
    alwaysBundle: (specifier) =>
      specifier !== "react" &&
      specifier !== "react-dom" &&
      specifier !== "react/jsx-runtime",
  },
  outputOptions: {
    // DSH fetches and evaluates only this classic ModuleLoader entrypoint, and
    // relative chunks are not materialized as independent loader modules, so
    // every runtime chunk has to stay inside the one registered factory. This
    // is also why the client cannot carry a diagram engine: a dependency tree
    // it must inline is a tree the QA page downloads on first paint.
    codeSplitting: false,
    entryFileNames: "client.js",
    sourcemapExcludeSources: false,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_NAME)}, factory: (require) => {`,
    intro: "var module = { exports: {} }; var exports = module.exports;",
    footer: "return module.exports; } });",
  },
};

export default [client];
