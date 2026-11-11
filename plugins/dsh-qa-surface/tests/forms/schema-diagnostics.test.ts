import { describe, expect, it } from "vitest";
import { formFailure, QaFormError } from "../../src/forms/errors.js";
import {
  parseFormSchema,
  DEFAULT_FORM_POLICY,
} from "../../src/forms/schema.js";
import type { QaFormFilesSpec } from "../../src/forms/types.js";
import { textOnly } from "./schemas.js";

const optional = {
  requirement: "optional",
  max_count: 2,
  accept: [".pdf", ".txt"],
  max_file_size_bytes: 5000000,
} as const;
function schema(files: unknown, withAnswer = false) {
  return {
    ...textOnly,
    steps: [
      {
        id: "step",
        title: "Files",
        items: [
          {
            id: "document",
            title: "Document",
            ...(withAnswer
              ? { answer: { type: "text", required: false } }
              : {}),
            files,
          },
        ],
      },
    ],
  };
}
function invalid(input: unknown) {
  try {
    parseFormSchema(input, DEFAULT_FORM_POLICY);
  } catch (error) {
    expect(error).toBeInstanceOf(QaFormError);
    return error as QaFormError;
  }
  throw new Error("Expected invalid form schema");
}
describe("form schema diagnostics", () => {
  it.each(["optional", "required"] as const)(
    "accepts complete %s file policies with or without an answer",
    (requirement) => {
      for (const withAnswer of [true, false]) {
        const files = {
          ...optional,
          requirement,
          ...(requirement === "required" ? { min_count: 1 } : {}),
        };
        expect(
          parseFormSchema(schema(files, withAnswer), DEFAULT_FORM_POLICY)
            .steps[0]!.items[0]!.files.requirement,
        ).toBe(requirement);
      }
    },
  );
  it("reports MIME types at the exact accept entry, without rejecting the requirement", () => {
    for (const requirement of ["optional", "required"]) {
      const error = invalid(
        schema({
          ...optional,
          requirement,
          ...(requirement === "required" ? { min_count: 1 } : {}),
          accept: ["application/pdf"],
        }),
      );
      expect(error.schemaIssues).toEqual([
        expect.objectContaining({
          path: "form.steps[0].items[0].files.accept[0]",
          message: expect.stringContaining("not MIME"),
        }),
      ]);
      expect(error.message).toContain("files.accept[0]");
    }
  });
  it("isolates optional min_count=0 and tells the caller to omit it", () => {
    const error = invalid(schema({ ...optional, min_count: 0 }));
    expect(error.schemaIssues).toEqual([
      expect.objectContaining({
        path: "form.steps[0].items[0].files.min_count",
        message: expect.stringContaining("omit"),
      }),
    ]);
  });
  it("lists every missing required file setting for the selected variant", () => {
    const error = invalid(schema({ requirement: "required" }));
    expect(error.schemaIssues?.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(
        ["min_count", "max_count", "accept", "max_file_size_bytes"].map(
          (key) => `form.steps[0].items[0].files.${key}`,
        ),
      ),
    );
  });
  it("identifies a missing root title independently from step and item titles", () => {
    const input: Record<string, unknown> = schema(optional);
    delete input.title;
    expect(invalid(input).schemaIssues).toEqual([
      expect.objectContaining({ path: "form.title" }),
    ]);
  });
  it("locates policy and conflicting count errors", () => {
    const files: QaFormFilesSpec = {
      ...optional,
      accept: [".txt"],
      requirement: "required",
      min_count: 3,
      max_count: 1,
      max_file_size_bytes: DEFAULT_FORM_POLICY.maxFileSizeBytes + 1,
    };
    const error = invalid(schema(files));
    expect(error.schemaIssues?.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        "form.steps[0].items[0].files.min_count",
        "form.steps[0].items[0].files.max_file_size_bytes",
      ]),
    );
    expect(formFailure(error)).toMatchObject({
      ok: false,
      error: { schema_errors: error.schemaIssues },
    });
  });
  it("does not echo rejected input values", () => {
    const error = invalid(
      schema({ ...optional, max_count: "private-value-sentinel" }),
    );
    expect(error.message).not.toContain("private-value-sentinel");
    expect(JSON.stringify(error.schemaIssues)).not.toContain(
      "private-value-sentinel",
    );
  });
});
