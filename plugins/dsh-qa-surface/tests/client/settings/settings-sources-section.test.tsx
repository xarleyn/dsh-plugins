// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SourcesSection } from "../../../src/client/settings/sections/sources.js";
import type { QaSurfaceConfig } from "../../../src/types.js";

function section(config: QaSurfaceConfig | undefined, writable = true) {
  const write = vi.fn();
  render(
    <SourcesSection
      config={config}
      effective={null}
      writable={writable}
      write={write}
      writeMany={vi.fn()}
      unset={vi.fn()}
      overridden={() => false}
    />,
  );
  return write;
}

function reportedSourceValidation(): HTMLInputElement {
  return screen.getByRole("checkbox", {
    name: /Проверять источники из отчёта/u,
  }) as HTMLInputElement;
}

describe("sources settings section", () => {
  afterEach(cleanup);

  it("shows reported-source validation on and writes it off", () => {
    const write = section({});
    const toggle = reportedSourceValidation();
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(write).toHaveBeenCalledWith(
      ["sources", "subagents", "validateReportedSources"],
      false,
    );
  });

  it("reflects a deployment that already turned the check off", () => {
    const write = section({
      sources: { subagents: { validateReportedSources: false } },
    });
    const toggle = reportedSourceValidation();
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    expect(write).toHaveBeenCalledWith(
      ["sources", "subagents", "validateReportedSources"],
      true,
    );
  });

  it("disables the switch with the rest of the section", () => {
    section({ sources: { enabled: false } });
    expect(reportedSourceValidation().disabled).toBe(true);
    cleanup();
    section(undefined, false);
    expect(reportedSourceValidation().disabled).toBe(true);
  });
});
