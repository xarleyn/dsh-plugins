/**
 * Shared fixtures for the page-controller tests, moved here verbatim from the
 * single-file original.
 */

import { vi } from "vitest";

import type { PersonaFace } from "../src/client/store.js";
import type {
  PersonaCatalog,
  PersonaDocument,
  PersonaDraft,
} from "../src/types.js";

export const DRAFT: PersonaDraft = {
  prefix: "You are a careful reviewer.",
  suffix: "",
  complete: false,
  includeRuntimeContext: true,
};

export function documentOf(
  patch: Partial<PersonaDocument> = {},
): PersonaDocument {
  return {
    id: "demo",
    name: "Demo",
    description: "",
    trust: "user",
    editable: true,
    isDefault: false,
    path: "/tmp/demo/agent.cordis.yml",
    hasRow: true,
    persona: {
      prefix: "Original prefix.",
      suffix: "",
      complete: false,
      includeRuntimeContext: true,
    },
    unknownKeys: [],
    foreignKeys: [],
    extraRows: 0,
    sections: [],
    sectionsState: "none",
    sectionsError: "",
    sectionsModule: "missing",
    sectionsUnknownKeys: [],
    readError: "",
    source: "- id: persona\n",
    prefixOrder: 0,
    suffixOrder: 10200,
    rowCount: 1,
    ...patch,
  };
}

export function catalogOf(): PersonaCatalog {
  return {
    presets: [
      {
        id: "demo",
        name: "Demo",
        description: "",
        trust: "user",
        isDefault: true,
        editable: true,
        broken: "",
        persona: "local",
        complete: false,
      },
    ],
  };
}

export const OK_CATALOG = { ok: true as const, value: catalogOf() };
export const OK_DOCUMENT = { ok: true as const, value: documentOf() };

/** A face whose calls a test can watch and steer. */
export function faceOf(overrides: Partial<PersonaFace> = {}): PersonaFace {
  return {
    list: vi.fn(async () => OK_CATALOG),
    read: vi.fn(async () => OK_DOCUMENT),
    ...overrides,
  };
}
