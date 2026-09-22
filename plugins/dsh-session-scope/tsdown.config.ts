import { defineConfig, type UserConfig } from "tsdown";

const ID = "dsh-session-scope";
const CLIENT_MODULE_ID = "@yadsh/dsh-session-scope";
/**
 * Both are shell statics: the web shell hands `react` and `react-dom` to every
 * client bundle, so they stay `require` calls inside the factory and the
 * bundle never ships a second copy of React.
 */
const CLIENT_EXTERNALS = ["react", "react-dom"];

/**
 * The client half is the only half tsdown builds here: the host entry points
 * (`./core`, `./scope-*`, …) are plain Node modules and stay on `tsc`, which
 * also emits every declaration. This config exists to turn `src/client.ts`
 * into the shell's classic bundle — the same wrapper every other plugin's
 * client gets — instead of a hand-written `window.__ModuleLoader__.load(...)`
 * script that the TypeScript compiler copied through unchanged.
 */
const client = {
  name: `${ID}/client`,
  entry: { client: "src/client.ts" },
  outDir: "lib",
  format: ["cjs"],
  platform: "browser",
  target: "es2024",
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: CLIENT_EXTERNALS,
    alwaysBundle: (specifier: string) => !CLIENT_EXTERNALS.includes(specifier),
  },
  outputOptions: {
    entryFileNames: "client.js",
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(CLIENT_MODULE_ID)}, factory: (require) => {`,
    intro: "var module = { exports: {} }; var exports = module.exports;",
    footer: "return module.exports; } });",
  },
} satisfies UserConfig;

export default defineConfig(client);
