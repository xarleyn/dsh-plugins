// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, it, vi, expect } from "vitest";
import { DiscoverySection } from "../../../src/client/settings/sections/discovery.js";
import { resolveConfig } from "../../../src/resolve-config.js";

afterEach(cleanup);
it("defaults to off, writes only the discovery setting and respects a read-only form", () => {
  const props = {
    config: {},
    effective: resolveConfig({}),
    writable: true,
    write: vi.fn(),
    unset: vi.fn(),
    writeMany: vi.fn(),
    overridden: () => false,
  };
  const view = render(<DiscoverySection {...props} />);
  const select = screen.getByRole("combobox") as HTMLSelectElement;
  expect(select.value).toBe("off");
  for (const value of ["observe", "search", "off"]) {
    fireEvent.change(select, { target: { value } });
    expect(props.write).toHaveBeenLastCalledWith(
      ["tools", "discoveryMode"],
      value,
    );
  }
  view.rerender(
    <DiscoverySection
      {...props}
      writable={false}
      config={{ tools: { discoveryMode: "observe" } }}
    />,
  );
  expect(select.disabled).toBe(true);
  expect(select.value).toBe("observe");
});
