import { vi } from "vitest";

import type { ClientLogger } from "../src/client/runtime.js";

export function dimensions(
  element: HTMLElement,
  values: {
    clientHeight: number;
    scrollHeight: number;
    clientWidth: number;
    scrollWidth: number;
  },
): void {
  for (const [property, value] of Object.entries(values)) {
    Object.defineProperty(element, property, {
      configurable: true,
      value,
    });
  }
}

export function quietLogger(): ClientLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}
