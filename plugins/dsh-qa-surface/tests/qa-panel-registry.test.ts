import { describe, expect, it, vi } from "vitest";
import { QaSurfacePanelRegistry } from "../src/client/panels/registry.js";

function definition(
  id: string,
  kind = id,
  options: {
    readonly title?: string;
    readonly order?: number;
    readonly userVisible?: boolean;
  } = {},
) {
  return {
    id,
    kind,
    title: () => options.title ?? id,
    ...(options.order === undefined ? {} : { order: options.order }),
    ...(options.userVisible === undefined
      ? {}
      : { userVisible: options.userVisible }),
  };
}

describe("QaSurfacePanelRegistry", () => {
  it("registers, sorts and unregisters definitions reactively", () => {
    const panels = new QaSurfacePanelRegistry();
    const changed = vi.fn();
    panels.subscribe(changed);
    const removeZulu = panels.register(
      definition("zulu", "zulu", { title: "Zulu", order: 10 }),
    );
    const removeBeta = panels.register(
      definition("beta", "beta", { title: "Beta", order: 0 }),
    );
    panels.register(definition("alpha", "alpha", { title: "Alpha", order: 0 }));

    expect(panels.list().map(({ id }) => id)).toEqual([
      "alpha",
      "beta",
      "zulu",
    ]);
    expect(changed).toHaveBeenCalledTimes(3);
    removeBeta();
    removeBeta();
    expect(panels.list().map(({ id }) => id)).toEqual(["alpha", "zulu"]);
    expect(changed).toHaveBeenCalledTimes(4);
    removeZulu();
  });

  it("rejects invalid and duplicate identities", () => {
    const panels = new QaSurfacePanelRegistry();
    expect(() => panels.register(definition(" "))).toThrow(
      /id must not be empty/u,
    );
    expect(() => panels.register(definition("id", " "))).toThrow(
      /kind must not be empty/u,
    );
    panels.register(definition("one", "alpha"));
    expect(() => panels.register(definition("one", "beta"))).toThrow(
      /duplicate id/u,
    );
    expect(() => panels.register(definition("two", "alpha"))).toThrow(
      /duplicate kind/u,
    );
  });

  it("opens, updates params, toggles and ignores unknown kinds", () => {
    const panels = new QaSurfacePanelRegistry();
    panels.register(definition("one", "alpha"));
    expect(panels.open("missing")).toBe(false);
    expect(panels.open("alpha", { focus: false, params: { value: 1 } })).toBe(
      true,
    );
    expect(panels.getActiveKind()).toBe("alpha");
    expect(panels.getSnapshot()).toMatchObject({
      activeKind: "alpha",
      params: { value: 1 },
      focus: false,
    });
    expect(panels.toggle("alpha")).toBe(true);
    expect(panels.getActiveKind()).toBeNull();
    expect(panels.toggle("missing")).toBe(false);
  });

  it("aborts and closes an active registration on deterministic cleanup", () => {
    const panels = new QaSurfacePanelRegistry();
    const remove = panels.register({
      ...definition("one", "alpha", { userVisible: false }),
      keepMounted: true,
    });
    const signal = panels.signal("alpha");
    panels.open("alpha");
    remove();
    expect(signal?.aborted).toBe(true);
    expect(panels.getActiveKind()).toBeNull();
    expect(panels.isRegistered("alpha")).toBe(false);
  });
});
