import type { TranslationPack } from "../types.js";

const example = Object.freeze({
  id: "example-plugin-en",
  target: Object.freeze({
    package: "dsh-example-plugin",
    versions: ">=0.4.0 <1.0.0",
  }),
  en: Object.freeze({
    "example.settings": Object.freeze({
      title: "Settings",
      enabled: "Enabled",
      server: "Server address",
      save: "Save",
    }),
  }),
  dom: Object.freeze([
    Object.freeze({
      scope: '[data-plugin="example-plugin"]',
      source: "设置",
      target: "Settings",
    }),
  ]),
  metadata: Object.freeze({
    sourceLanguage: "zh",
    description: "Example English translation pack",
  }),
}) satisfies TranslationPack;

export default example;
