// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocsSection } from "../../../src/client/settings/sections/docs.js";
import { resolveConfig } from "../../../src/resolve-config.js";
import type { QaSurfaceConfig } from "../../../src/types.js";

function section(
  config: QaSurfaceConfig | undefined,
  options: {
    writable?: boolean;
    effective?: ReturnType<typeof resolveConfig> | null;
  } = {},
) {
  const write = vi.fn();
  render(
    <DocsSection
      config={config}
      effective={options.effective ?? null}
      writable={options.writable ?? true}
      write={write}
      writeMany={vi.fn()}
      unset={vi.fn()}
      overridden={() => false}
    />,
  );
  return write;
}

function defaultVersionToggle(): HTMLInputElement {
  return screen.getByRole("checkbox", {
    name: /Версия по умолчанию/u,
  }) as HTMLInputElement;
}

function versionField(): HTMLInputElement {
  // The field's own label is `Версия` followed by its hint; the switch's label
  // starts with the same word, so the role keeps the two apart.
  return screen.getByRole("textbox", { name: /^Версия/u }) as HTMLInputElement;
}

describe("documentation settings section", () => {
  afterEach(cleanup);

  it("writes the switch that applies the default version", () => {
    const write = section({});
    const toggle = defaultVersionToggle();
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    expect(write).toHaveBeenCalledWith(
      ["tools", "docsDefaultVersionEnabled"],
      true,
    );
  });

  it("reflects a deployment that already runs a default version", () => {
    const write = section({
      tools: { docsDefaultVersion: "3.8", docsDefaultVersionEnabled: true },
    });
    expect(defaultVersionToggle().checked).toBe(true);
    expect(versionField().value).toBe("3.8");
    fireEvent.change(versionField(), { target: { value: "4.0" } });
    fireEvent.blur(versionField());
    expect(write).toHaveBeenCalledWith(["tools", "docsDefaultVersion"], "4.0");
  });

  it("keeps the version while the switch is off, and explains the pair", () => {
    const write = section({ tools: { docsDefaultVersion: "3.8" } });
    expect(defaultVersionToggle().checked).toBe(false);
    expect(versionField().value).toBe("3.8");
    fireEvent.click(defaultVersionToggle());
    expect(write).toHaveBeenCalledWith(
      ["tools", "docsDefaultVersionEnabled"],
      true,
    );
    expect(screen.queryByText(/по-прежнему идёт по всем/u)).toBeNull();
  });

  it("says the default is doing nothing when the switch is on and the version is empty", () => {
    section({ tools: { docsDefaultVersionEnabled: true } });
    expect(screen.getByText(/по-прежнему идёт по всем/u)).toBeTruthy();
  });

  it("shows the corpus root the running Host reports", async () => {
    section(
      {},
      {
        effective: resolveConfig({ tools: { docsRoot: "/srv/stand/docs" } }),
      },
    );
    await waitFor(() => {
      expect(screen.getByText("/srv/stand/docs")).toBeTruthy();
    });
  });

  it("names the per-chat layout when the deployment publishes no shared corpus", () => {
    section({}, { effective: resolveConfig({}) });
    expect(screen.getByText(/docs\/ рабочего каталога чата/u)).toBeTruthy();
  });

  it("disables both controls with the rest of the card", () => {
    section(
      { tools: { docsDefaultVersion: "3.8", docsDefaultVersionEnabled: true } },
      { writable: false },
    );
    expect(defaultVersionToggle().disabled).toBe(true);
    expect(versionField().disabled).toBe(true);
  });
});
