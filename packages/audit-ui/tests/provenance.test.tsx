// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { isKnownAnalysis, validateAuditAnalysis } from "@yadsh/dsh-audit-core";
import { AuditProvenance } from "../src/components/AuditProvenance.js";

function analysis(schemaVersion: number, metadata: object = {}) {
  const result = validateAuditAnalysis({
    schemaVersion,
    trajectory: { sessionId: "session-demo" },
    ...metadata,
  });
  return result.ok && isKnownAnalysis(result.analysis) ? result.analysis : null;
}

describe("AuditProvenance", () => {
  it("shows producer name and version and keeps the auditor and session models separate", () => {
    const { container } = render(
      <AuditProvenance
        analysis={analysis(2, {
          trajectory: { sessionId: "session-demo", model: "demo/chat-model" },
          audit: {
            producer: { name: "@demo/report-builder", version: "1.2.3" },
          },
          auditor: { type: "llm", model: "demo/models/reviewer" },
        })}
      />,
    );
    expect(
      [...container.querySelectorAll("dl > div")].map((row) => [
        row.querySelector("dt")?.textContent,
        row.querySelector("dd")?.textContent,
      ]),
    ).toEqual([
      ["Report producer", "@demo/report-builder"],
      ["Producer version", "1.2.3"],
      ["Auditor type", "llm"],
      ["Auditor model", "demo/models/reviewer"],
      ["Session model", "demo/chat-model"],
    ]);
  });

  it("shows only the session model in a legacy audit and omits unavailable fields", () => {
    const { container, rerender } = render(
      <AuditProvenance analysis={analysis(1)} sessionModel="demo-legacy" />,
    );
    expect(container.textContent).toBe("Session modeldemo-legacy");
    rerender(
      <AuditProvenance
        analysis={analysis(2, { auditor: { type: "manual", model: "" } })}
      />,
    );
    expect(container.textContent).toBe("Auditor typemanual");
    rerender(
      <AuditProvenance
        analysis={analysis(9, { auditor: { model: "future-label" } })}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("leaves markup, paths and credential-shaped strings out of the provenance display", () => {
    const { container } = render(
      <AuditProvenance
        analysis={analysis(2, {
          trajectory: {
            sessionId: "session-demo",
            model: "/home/demo/models/file.gguf",
            cwd: "/work/demo",
          },
          audit: {
            producer: {
              name: "<img src=x>",
              version: "Bearer example-token",
            },
          },
          auditor: {
            type: "llm",
            model: "https://user:pass@example.invalid/model",
          },
        })}
      />,
    );
    expect(container.textContent).toBe("Auditor typellm");
    expect(container.querySelector("a, img, script")).toBeNull();
  });
});
