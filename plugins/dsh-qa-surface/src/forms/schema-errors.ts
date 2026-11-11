import type { z } from "zod";
import { QaFormError } from "./errors.js";
import type { QaFormSchemaIssue } from "./types.js";

/** Report locations and constraints, never copy input values into diagnostics. */
export function formSchemaError(issues: QaFormSchemaIssue[]): QaFormError {
  const bounded = issues.slice(0, 50);
  const detail = bounded
    .slice(0, 8)
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join("; ");
  return new QaFormError(
    "INVALID_SCHEMA",
    `Invalid form schema. ${detail}${issues.length > 8 ? "; additional issues are listed in schema_errors." : ""}`,
    undefined,
    undefined,
    bounded,
  );
}

export function formSchemaIssues(
  issues: z.ZodError["issues"],
): QaFormSchemaIssue[] {
  return issues
    .flatMap((issue): QaFormSchemaIssue[] => {
      // Discriminated unions usually point directly at the selected variant.
      // Flatten nested union diagnostics as well rather than losing the field.
      if (issue.code === "invalid_union" && issue.errors.length > 0)
        return formSchemaIssues(issue.errors.flat());
      const path =
        "form" +
        issue.path
          .map((part) =>
            typeof part === "number"
              ? `[${part}]`
              : `.${String(part).slice(0, 100)}`,
          )
          .join("");
      if (issue.code === "unrecognized_keys")
        return issue.keys.map((key) => ({
          path: `${path}.${key.slice(0, 100)}`,
          code: issue.code,
          message:
            key === "min_count" && issue.path.at(-1) === "files"
              ? "min_count is supported only for required files; omit it for optional or none."
              : "Unsupported field for this requirement or answer type.",
        }));
      return [
        {
          path,
          code: issue.code,
          message:
            issue.code === "invalid_union" &&
            issue.path.at(-1) === "requirement"
              ? "Use none, optional or required."
              : issue.code === "invalid_format" && issue.path.includes("accept")
                ? "Use lowercase extensions such as .txt or .pdf, not MIME types or wildcards."
                : issue.message,
        },
      ];
    })
    .slice(0, 50);
}
