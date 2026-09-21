import { vi } from "vitest";
import type { QaSkillValidationState } from "../src/client/user-settings/SkillEditor.js";
import type { QaBoundSkillApi } from "../src/client/types.js";
import type {
  QaSkillDocument,
  QaSkillDraftInput,
  QaSkillSummary,
  QaSkillToolDescriptor,
} from "../src/types.js";

export const TOOLS: readonly QaSkillToolDescriptor[] = [
  { name: "read", description: "Read a file", available: true },
  { name: "grep", description: "Search files", available: true },
  { name: "write", description: "Write a file", available: false },
  { name: "jira_transition", description: "", available: false },
];

/** What the Host answers about the draft; tests set the interesting parts. */
export function validation(
  overrides: Partial<QaSkillValidationState> = {},
): QaSkillValidationState {
  return {
    preview: `---
name: api-testing
description: Тестирование.
---

1. Шаг
`,
    diagnostics: [],
    pending: false,
    ...overrides,
  };
}

export const onDraftChange = vi.fn<(input: QaSkillDraftInput) => void>();

export function summary(
  overrides: Partial<QaSkillSummary> = {},
): QaSkillSummary {
  return {
    name: "api-testing",
    description: "Тестирование REST и GraphQL API",
    whenToUse: null,
    modelInvocable: true,
    userInvocable: true,
    allowedTools: ["read"],
    unavailableTools: [],
    resourceCount: 0,
    valid: true,
    diagnostics: [],
    updatedAt: "2026-09-14T10:00:00.000Z",
    revision: "rev-1",
    adminEdit: null,
    ...overrides,
  };
}

export function skillDocument(
  overrides: Partial<QaSkillDocument> = {},
): QaSkillDocument {
  return {
    ...summary(),
    body: "1. Шаг",
    extraFrontmatter: { license: "MIT" },
    sourcePath: "/workspace/.dsh/skills/api-testing/SKILL.md",
    preview: "",
    ...overrides,
  };
}

export function api(
  options: {
    readonly skills?: readonly QaSkillSummary[];
    readonly documents?: Readonly<Record<string, QaSkillDocument>>;
    readonly tools?: readonly QaSkillToolDescriptor[];
    readonly listFails?: string;
  } = {},
): {
  readonly api: QaBoundSkillApi;
  readonly created: unknown[];
  readonly updated: unknown[];
  readonly removed: unknown[];
  readonly validated: unknown[];
} {
  const created: unknown[] = [];
  const updated: unknown[] = [];
  const removed: unknown[] = [];
  const validated: unknown[] = [];
  // The catalog follows the writes, the way the Host's does.
  const state = { skills: [...(options.skills ?? [])] };
  const documents = options.documents ?? {};
  return {
    created,
    updated,
    removed,
    validated,
    api: {
      list: async () =>
        options.listFails === undefined
          ? { ok: true, value: state.skills }
          : { ok: false, error: new Error(`(reason: ${options.listFails})`) },
      get: async (name) =>
        documents[name] === undefined
          ? { ok: false, error: new Error("(reason: skill-not-found)") }
          : { ok: true, value: documents[name] },
      create: async (input) => {
        created.push(input);
        state.skills = [...state.skills, summary({ name: input.name })];
        return { ok: true, value: skillDocument({ name: input.name }) };
      },
      update: async (name, input) => {
        updated.push({ name, input });
        return { ok: true, value: skillDocument({ name: input.name }) };
      },
      remove: async (name, expectedRevision) => {
        removed.push({ name, expectedRevision });
        state.skills = state.skills.filter((skill) => skill.name !== name);
        return { ok: true, value: { name, trashed: true } };
      },
      tools: async () => ({ ok: true, value: options.tools ?? TOOLS }),
      validate: async (_name, input) => {
        validated.push(input);
        return {
          ok: true,
          value: {
            preview: `---
name: ${input.name}
---
`,
            diagnostics: [],
          },
        };
      },
    },
  };
}
