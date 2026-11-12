// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileWritesSection } from "../../../src/client/settings/sections/file-writes.js";
import { resolveConfig } from "../../../src/resolve-config.js";
import type { QaSurfaceConfig } from "../../../src/types.js";

function section(config: QaSurfaceConfig = {}, writable = true) {
  const write = vi.fn();
  render(
    <FileWritesSection
      config={config}
      effective={resolveConfig(config)}
      writable={writable}
      write={write}
      writeMany={vi.fn()}
      unset={vi.fn()}
      overridden={() => false}
    />,
  );
  return write;
}

describe("file write settings", () => {
  afterEach(cleanup);

  it("shows the effective default restrictions and refusal message", () => {
    section();
    expect(
      (screen.getByLabelText(/^Запрещённые расширения/u) as HTMLTextAreaElement)
        .value,
    ).toBe(".py\n.pyw");
    expect(
      (screen.getByLabelText(/^Сообщение агенту/u) as HTMLTextAreaElement)
        .value,
    ).toContain("Не создавайте");
  });

  it("saves extensions and the refusal message on blur", () => {
    const write = section();
    const extensions = screen.getByLabelText(/^Запрещённые расширения/u);
    fireEvent.change(extensions, { target: { value: ".py, ps1\n.js; .sh" } });
    expect(write).not.toHaveBeenCalled();
    fireEvent.blur(extensions);
    expect(write).toHaveBeenCalledWith(
      ["tools", "fileWritePolicy", "blockedExtensions"],
      [".py", "ps1", ".js", ".sh"],
    );
    const message = screen.getByLabelText(/^Сообщение агенту/u);
    fireEvent.change(message, { target: { value: "Use document tools." } });
    fireEvent.blur(message);
    expect(write).toHaveBeenCalledWith(
      ["tools", "fileWritePolicy", "message"],
      "Use document tools.",
    );
  });

  it("allows clearing the list without replacing it with defaults", () => {
    const write = section();
    const field = screen.getByLabelText(/^Запрещённые расширения/u);
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    expect(write).toHaveBeenCalledWith(
      ["tools", "fileWritePolicy", "blockedExtensions"],
      [],
    );
    cleanup();
    section({ tools: { fileWritePolicy: { blockedExtensions: [] } } });
    expect(
      (screen.getByLabelText(/^Запрещённые расширения/u) as HTMLTextAreaElement)
        .value,
    ).toBe("");
  });

  it("keeps the policy visible with disabled controls on a read-only form", () => {
    section({}, false);
    for (const field of screen.getAllByRole("textbox"))
      expect((field as HTMLTextAreaElement).disabled).toBe(true);
  });
});
