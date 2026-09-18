// @vitest-environment jsdom

import { afterEach, vi } from "vitest";
import { Diagnostics } from "../src/registry/diagnostics.js";
import { DomTranslator } from "../src/runtime/dom-translator.js";
import type { DomTranslationRule } from "../src/types.js";

export function createDiagnostics(): Diagnostics {
  return new Diagnostics({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  });
}

export const translators = new Set<DomTranslator>();

export function createTranslator(
  rules: readonly DomTranslationRule[],
  diagnostics = createDiagnostics(),
): DomTranslator {
  const translator = new DomTranslator(document, rules, diagnostics);
  translators.add(translator);
  return translator;
}

afterEach(() => {
  for (const translator of translators) translator.dispose();
  translators.clear();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

export async function flushMutations(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
