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

function queryByTestId(root: ParentNode, testId: string): Element | null {
  return root.querySelector(`[data-testid="${testId}"]`);
}

export function getByTestId(root: ParentNode, testId: string): Element {
  const node = queryByTestId(root, testId);
  if (node === null) {
    throw new Error(
      `No element of the fixture carries data-testid="${testId}".`,
    );
  }
  return node;
}

export async function flushMutations(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
