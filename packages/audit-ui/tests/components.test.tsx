/**
 * Rendering tests: the assertions that matter are the ones about what must
 * *not* reach the DOM (SPEC §62, §74).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  AuditEmptyState,
  AuditErrorState,
  AuditFindings,
  AuditReport,
  AuditStatusBar,
  AuditTabs,
} from "../src/index.js";
import { renderMarkdown } from "../src/index.js";
import type { AuditFinding } from "@yadsh/dsh-audit-core";

const finding = (overrides: Partial<AuditFinding>): AuditFinding => ({
  id: "F1",
  severity: "major",
  category: "grounding",
  title: "A title",
  status: "observed",
  rootCause: "AGENT",
  description: "A description",
  evidence: ["seq:24"],
  recommendationTarget: "agent_instruction",
  ...overrides,
});

describe("AuditReport", () => {
  it("renders a table, which the report format depends on", () => {
    const { container } = render(
      <AuditReport
        markdown={"| Dimension | Score |\n| --- | --- |\n| task_success | 3 |"}
      />,
    );

    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(container.querySelectorAll("th")).toHaveLength(2);
    expect(container.querySelectorAll("tbody td")).toHaveLength(2);
  });

  it("renders a script tag as literal text, never as an element", () => {
    const { container } = render(
      <AuditReport markdown={'Before <script>alert("x")</script> after'} />,
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain('<script>alert("x")</script>');
  });

  it("does not make a javascript: destination clickable", () => {
    const { container } = render(
      <AuditReport markdown={"[click me](javascript:alert(1))"} />,
    );

    expect(container.querySelector("a")).toBeNull();
    // The label survives; only the link does not.
    expect(container.textContent).toContain("click me");
  });

  it("renders an https link with a safe rel", () => {
    const { container } = render(
      <AuditReport markdown={"[docs](https://example.com/x)"} />,
    );

    const anchor = container.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe("https://example.com/x");
    expect(anchor?.getAttribute("rel")).toContain("noreferrer");
  });

  it("refuses an image with an unsafe source and keeps its alt text", () => {
    const { container } = render(
      <AuditReport markdown={"![a shot](javascript:alert(1))"} />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("a shot");
  });

  it("builds a table of contents whose anchors exist in the body", () => {
    const markdown = [
      "# Trajectory Review",
      "",
      "## Verdict",
      "",
      "Mixed.",
      "",
      "## Scorecard",
      "",
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
    ].join("\n");
    const { container } = render(<AuditReport markdown={markdown} />);

    const links = [...container.querySelectorAll(".dsh-audit-report__toc a")];
    expect(links.length).toBeGreaterThan(2);
    for (const link of links) {
      const id = link.getAttribute("href")?.slice(1) ?? "";
      expect(container.querySelector(`[id="${id}"]`)).not.toBeNull();
    }
  });

  it("reports an empty document rather than rendering nothing", () => {
    render(<AuditReport markdown={""} />);

    expect(screen.getByText("This audit has no report.")).toBeDefined();
  });

  it("renders markdown directly for a caller that has no report component", () => {
    const { container } = render(<div>{renderMarkdown("**bold**")}</div>);

    expect(container.querySelector("strong")?.textContent).toBe("bold");
  });
});

describe("AuditStatusBar", () => {
  const findings = {
    critical: 1,
    major: 2,
    minor: 0,
    observation: 1,
    other: 0,
  };

  it("leads with the verdict and summarises the findings", () => {
    render(
      <AuditStatusBar
        verdict="mixed"
        outcomeStatus="completed_with_gaps"
        evidenceLevel="rich"
        findings={findings}
      />,
    );

    expect(screen.getByText("Mixed")).toBeDefined();
    expect(screen.getByText("completed with gaps")).toBeDefined();
    expect(screen.getByText("rich evidence")).toBeDefined();
    // Only non-zero buckets appear, most severe first.
    expect(
      screen.getByText("1 critical · 2 major · 1 observation"),
    ).toBeDefined();
  });

  it("says so when there are no findings", () => {
    render(
      <AuditStatusBar
        verdict="good"
        findings={{ critical: 0, major: 0, minor: 0, observation: 0, other: 0 }}
      />,
    );

    expect(screen.getByText("No findings")).toBeDefined();
  });

  it("keeps a verdict it does not recognise visible as-is", () => {
    render(
      <AuditStatusBar
        verdict="triumphant"
        findings={{ critical: 0, major: 0, minor: 0, observation: 0, other: 0 }}
      />,
    );

    expect(screen.getByText("triumphant")).toBeDefined();
  });

  it("shows an em dash rather than a wrong count for an unrecorded total", () => {
    render(
      <AuditStatusBar
        verdict="good"
        findings={{ critical: 0, major: 0, minor: 0, observation: 0, other: 0 }}
        toolCalls={-1}
        toolErrors={-1}
      />,
    );

    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("drops the metadata row in the compact form", () => {
    const { container } = render(
      <AuditStatusBar
        verdict="good"
        findings={{ critical: 0, major: 0, minor: 0, observation: 0, other: 0 }}
        model="demo-model-v1"
        compact
      />,
    );

    expect(container.querySelector(".dsh-audit-status__meta")).toBeNull();
    expect(
      container.querySelector(".dsh-audit-status--compact"),
    ).not.toBeNull();
  });
});

describe("AuditFindings", () => {
  it("groups by severity, most severe first", () => {
    const { container } = render(
      <AuditFindings
        findings={[
          finding({ id: "F1", severity: "minor" }),
          finding({ id: "F2", severity: "critical" }),
          finding({ id: "F3", severity: "major" }),
        ]}
      />,
    );

    const titles = [
      ...container.querySelectorAll(".dsh-audit-findings__group-title"),
    ];
    expect(titles.map((title) => title.textContent)).toEqual([
      "critical1",
      "major1",
      "minor1",
    ]);
  });

  it("gives an unknown severity its own group under the producer's word", () => {
    const { container } = render(
      <AuditFindings findings={[finding({ severity: "catastrophic" })]} />,
    );

    expect(
      container.querySelector(".dsh-audit-findings__group-title")?.textContent,
    ).toBe("catastrophic1");
  });

  it("groups an absent severity as unclassified", () => {
    const { container } = render(
      <AuditFindings findings={[finding({ severity: "" })]} />,
    );

    expect(
      container.querySelector(".dsh-audit-findings__group-title")?.textContent,
    ).toBe("unclassified1");
  });

  it("renders a malicious title as text", () => {
    const { container } = render(
      <AuditFindings
        findings={[finding({ title: '<img src=x onerror="alert(1)">' })]}
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it("states that there are none rather than rendering nothing", () => {
    render(<AuditFindings findings={[]} />);

    expect(screen.getByText("The auditor recorded no findings.")).toBeDefined();
  });

  it("carries the root cause, target and evidence onto the card", () => {
    render(<AuditFindings findings={[finding({})]} />);

    expect(screen.getByText("Root cause")).toBeDefined();
    expect(screen.getByText("AGENT")).toBeDefined();
    expect(screen.getByText("agent_instruction")).toBeDefined();
    expect(screen.getByText("seq:24")).toBeDefined();
  });
});

describe("states and tabs", () => {
  it("names the empty state", () => {
    render(<AuditEmptyState />);

    expect(
      screen.getByText("No audit available for this session"),
    ).toBeDefined();
  });

  it("offers a retry only when one was supplied", () => {
    const { rerender } = render(<AuditErrorState />);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();

    rerender(<AuditErrorState onRetry={() => {}} />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
  });

  it("marks the active tab for assistive technology", () => {
    const { container } = render(
      <AuditTabs
        tabs={[
          { id: "report", label: "Report" },
          { id: "findings", label: "Findings" },
        ]}
        active="findings"
        onSelect={() => {}}
      />,
    );

    const tabs = [...container.querySelectorAll('[role="tab"]')];
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual([
      "false",
      "true",
    ]);
  });
});
