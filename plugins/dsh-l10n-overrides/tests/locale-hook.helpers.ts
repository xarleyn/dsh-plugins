import { vi } from "vitest";
import { Diagnostics } from "../src/registry/diagnostics.js";
import { TranslationPackRegistry } from "../src/registry/translation-registry.js";

export function createDiagnostics(debug = false): Diagnostics {
  return new Diagnostics(
    {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    { debug },
  );
}

export function createRegistry(
  diagnostics = createDiagnostics(),
): TranslationPackRegistry {
  const registry = new TranslationPackRegistry(diagnostics);
  registry.register({
    id: "composer-pack",
    target: { package: "example" },
    en: { composer: { greeting: "Hello {name}" } },
  });
  return registry;
}

export function createTranslator(value: string) {
  return vi.fn(
    (_namespace: string, _key: string, _params?: Record<string, unknown>) =>
      value,
  );
}
