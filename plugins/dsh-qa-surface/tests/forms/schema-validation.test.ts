import { describe, expect, it } from "vitest";
import {
  DEFAULT_FORM_POLICY,
  parseFormSchema,
} from "../../src/forms/schema.js";
import {
  normalizeFormAnswer,
  validateForm,
} from "../../src/forms/validation.js";
import type {
  QaFormAnswerSpec,
  QaFormRecord,
  QaFormSchema,
} from "../../src/forms/types.js";
import { intake, textOnly } from "./fixture.js";

describe("strict form schema", () => {
  it("keeps exactly one optional intake item", () => {
    const schema = parseFormSchema(intake, DEFAULT_FORM_POLICY),
      items = schema.steps.flatMap((s) => s.items);
    expect(items).toHaveLength(4);
    expect(
      items
        .filter(
          (i) => !i.answer?.required && i.files.requirement !== "required",
        )
        .map((i) => i.id),
    ).toEqual(["additional"]);
  });
  it.each([
    (s: QaFormSchema) => {
      s.steps = [];
    },
    (s: QaFormSchema) => {
      s.steps.push(structuredClone(s.steps[0]!));
    },
    (s: QaFormSchema) => {
      s.steps[0]!.items.push(structuredClone(s.steps[0]!.items[0]!));
    },
    (s: QaFormSchema) => {
      s.steps[0]!.items[0]!.id = "../escape";
    },
    (s: QaFormSchema) => {
      s.steps[0]!.items[0]!.id = "constructor";
    },
    (s: QaFormSchema) => {
      s.steps[0]!.items[0]!.files = { requirement: "none" };
      delete s.steps[0]!.items[0]!.answer;
    },
    (s: QaFormSchema) => {
      Object.assign(s.steps[0]!.items[0]!.files, { accept: ["*"] });
    },
    (s: QaFormSchema) => {
      Object.assign(s.steps[0]!.items[0]!.files, {
        min_count: 4,
        max_count: 1,
      });
    },
    (s: QaFormSchema) => {
      Object.assign(s.steps[0]!.items[1]!.files, { min_count: 1 });
    },
    (s: QaFormSchema) => {
      Object.assign(s.steps[1]!.items[0]!.files, { max_count: 1 });
    },
    (s: QaFormSchema) => {
      Object.assign(s.steps[0]!.items[0]!.answer!, { required: undefined });
    },
    (s: QaFormSchema) => {
      Object.assign(s.steps[1]!.items[0]!.answer!, {
        min_selected: 3,
        max_selected: 1,
      });
    },
    (s: QaFormSchema) => {
      Object.assign(s.steps[1]!.items[0]!.answer!, {
        options: [
          { value: "x", label: "A" },
          { value: "x", label: "B" },
        ],
      });
    },
  ])("rejects unsafe/inconsistent schema %#", (change) => {
    const s = structuredClone(intake);
    change(s);
    expect(() => parseFormSchema(s, DEFAULT_FORM_POLICY)).toThrow();
  });
  it("enforces policy instead of silently clamping the displayed schema", () => {
    expect(() =>
      parseFormSchema(intake, { ...DEFAULT_FORM_POLICY, maxFileSizeBytes: 1 }),
    ).toThrow();
    expect(() =>
      parseFormSchema(intake, { ...DEFAULT_FORM_POLICY, maxSchemaBytes: 1 }),
    ).toThrow();
  });
});
describe("independent answer and file requirements", () => {
  it.each([true, false])(
    "uses Unicode code points and validates nonempty optional text (required=%s)",
    (required) => {
      const spec: QaFormAnswerSpec = {
        type: "text",
        required,
        min_length: 2,
        max_length: 2,
      };
      expect(
        normalizeFormAnswer(
          spec,
          { type: "text", text: " 🙂🙂 " },
          DEFAULT_FORM_POLICY,
        ),
      ).toEqual({ type: "text", text: "🙂🙂" });
      expect(() =>
        normalizeFormAnswer(
          spec,
          { type: "text", text: "🙂" },
          DEFAULT_FORM_POLICY,
        ),
      ).toThrow();
      expect(
        normalizeFormAnswer(
          spec,
          { type: "text", text: " " },
          DEFAULT_FORM_POLICY,
        ),
      ).toBeNull();
      if (required)
        expect(() =>
          normalizeFormAnswer(spec, null, DEFAULT_FORM_POLICY, true),
        ).toThrow();
    },
  );
  it.each([true, false])(
    "rejects duplicate/unknown/extra selections (required=%s)",
    (required) => {
      const spec: QaFormAnswerSpec = {
        type: "multi_select",
        required,
        min_selected: 2,
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      };
      for (const raw of [
        { type: "multi_select", selected: ["a", "a"] },
        { type: "multi_select", selected: ["foreign"] },
        { type: "multi_select", selected: ["a"] },
        { type: "multi_select", selected: ["a", "b"], ready: true },
      ])
        expect(() =>
          normalizeFormAnswer(spec, raw, DEFAULT_FORM_POLICY),
        ).toThrow();
      expect(
        normalizeFormAnswer(
          spec,
          { type: "multi_select", selected: [] },
          DEFAULT_FORM_POLICY,
        ),
      ).toBeNull();
    },
  );
  it("counts other as one selection and forbids mixed single-select mode", () => {
    const spec: QaFormAnswerSpec = {
      type: "single_select",
      required: true,
      allow_other: true,
      options: [{ value: "a", label: "A", recommended: true }],
    };
    expect(() =>
      normalizeFormAnswer(
        spec,
        { type: "single_select", selected: ["a"], other_text: "Other" },
        DEFAULT_FORM_POLICY,
      ),
    ).toThrow();
    expect(
      normalizeFormAnswer(
        spec,
        { type: "single_select", selected: [], other_text: "Other" },
        DEFAULT_FORM_POLICY,
      ),
    ).toEqual({ type: "single_select", selected: [], other_text: "Other" });
    expect(() =>
      normalizeFormAnswer(spec, null, DEFAULT_FORM_POLICY, true),
    ).toThrow();
  });
  it("checks every saved item even when the browser omitted it", () => {
    const r = {
      schema: textOnly,
      answers: {},
      attachments: {},
      uploads: [],
    } as unknown as QaFormRecord;
    expect(validateForm(r, DEFAULT_FORM_POLICY)).toEqual([
      expect.objectContaining({ item_id: "answer", component: "answer" }),
    ]);
  });
});
