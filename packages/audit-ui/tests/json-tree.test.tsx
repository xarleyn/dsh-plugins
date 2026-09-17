import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AuditJsonTree } from "../src/index.js";

const DOCUMENT = {
  schemaVersion: 1,
  verdict: "mixed",
  findings: [
    { id: "F1", severity: "major", title: "A title" },
    { id: "F2", severity: "minor", title: "Another" },
  ],
  nested: { deep: { deeper: true } },
};

describe("AuditJsonTree", () => {
  it("opens the root and the first level by default", () => {
    render(<AuditJsonTree value={DOCUMENT} />);

    expect(screen.getByText("schemaVersion")).toBeDefined();
    expect(screen.getByText("verdict")).toBeDefined();
    // `findings` is a first-level container: collapsed, so its children hide.
    expect(screen.getByText("findings")).toBeDefined();
    expect(screen.queryByText("severity")).toBeNull();
  });

  it("expands and collapses a node", () => {
    render(<AuditJsonTree value={DOCUMENT} />);

    fireEvent.click(screen.getByLabelText("Expand nested"));
    expect(screen.getByText("deep")).toBeDefined();

    fireEvent.click(screen.getByLabelText("Collapse nested"));
    expect(screen.queryByText("deep")).toBeNull();
  });

  it("expands everything on demand", () => {
    render(<AuditJsonTree value={DOCUMENT} />);

    fireEvent.click(screen.getByText("Expand all"));

    expect(screen.getByText("deeper")).toBeDefined();
    expect(screen.getAllByText('"F1"').length).toBeGreaterThan(0);
  });

  it("collapses back to the root", () => {
    render(<AuditJsonTree value={DOCUMENT} />);
    fireEvent.click(screen.getByText("Expand all"));

    fireEvent.click(screen.getByText("Collapse all"));

    expect(screen.queryByText("schemaVersion")).toBeNull();
  });

  it("filters on keys and values, opening what it finds", () => {
    render(<AuditJsonTree value={DOCUMENT} />);

    fireEvent.change(screen.getByLabelText("Filter JSON"), {
      target: { value: "severity" },
    });

    expect(screen.getByText("findings")).toBeDefined();
    expect(screen.getAllByText("severity").length).toBeGreaterThan(0);
    expect(screen.queryByText("schemaVersion")).toBeNull();
  });

  it("says so when a filter matches nothing", () => {
    render(<AuditJsonTree value={DOCUMENT} />);

    fireEvent.change(screen.getByLabelText("Filter JSON"), {
      target: { value: "no-such-key-anywhere" },
    });

    expect(screen.getByText("Nothing matches this filter.")).toBeDefined();
  });

  it("switches to raw and back", () => {
    const { container } = render(<AuditJsonTree value={DOCUMENT} />);

    fireEvent.click(screen.getByText("Raw"));
    expect(container.querySelector(".dsh-audit-json__raw")).not.toBeNull();
    expect(screen.getByText("Copy all")).toBeDefined();

    fireEvent.click(screen.getByText("Tree"));
    expect(container.querySelector(".dsh-audit-json__tree")).not.toBeNull();
  });

  it("falls back to raw for a document too large to walk", () => {
    const huge = { blob: "x".repeat(600 * 1024) };
    const { container } = render(<AuditJsonTree value={huge} />);

    expect(container.querySelector(".dsh-audit-json__raw")).not.toBeNull();
    expect(
      screen.getByText(
        "The document is too large to render as a tree, so it is shown raw.",
      ),
    ).toBeDefined();
  });

  it("renders a malicious string as text, not markup", () => {
    const { container } = render(
      <AuditJsonTree value={{ title: '<img src=x onerror="alert(1)">' }} />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("img src=x");
  });

  it("uses an SVG chevron rather than a font glyph", () => {
    const { container } = render(<AuditJsonTree value={DOCUMENT} />);

    const chevrons = container.querySelectorAll(".dsh-audit-json__chevron");
    expect(chevrons.length).toBeGreaterThan(0);
    expect(chevrons[0]?.querySelector("path")).not.toBeNull();
    expect(container.textContent).not.toContain("▾");
    expect(container.textContent).not.toContain("▸");
  });

  it("survives a value that is not an object", () => {
    render(<AuditJsonTree value={"just a string"} />);

    expect(screen.getByText('"just a string"')).toBeDefined();
  });
});
