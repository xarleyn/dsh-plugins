// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { UIRepairRuntime } from "../src/client/runtime.js";

function dimensions(
  element: HTMLElement,
  values: {
    clientHeight: number;
    scrollHeight: number;
    clientWidth: number;
    scrollWidth: number;
  },
): void {
  for (const [property, value] of Object.entries(values)) {
    Object.defineProperty(element, property, {
      configurable: true,
      value,
    });
  }
}

function quietLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

afterEach(() => {
  document.head
    .querySelectorAll("[data-dsh-ui-repair-style]")
    .forEach((element) => element.remove());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("UIRepairRuntime", () => {
  it("reports overflow in observe mode without mutating the target", async () => {
    document.body.innerHTML = `
      <section data-dsh-ui-repair-root="fixture">
        <div id="panel" style="overflow-y: hidden"></div>
      </section>
    `;
    const panel = document.querySelector("#panel") as HTMLElement;
    dimensions(panel, {
      clientHeight: 100,
      scrollHeight: 164,
      clientWidth: 200,
      scrollWidth: 200,
    });
    const runtime = new UIRepairRuntime(
      document,
      { mode: "observe", observeMutations: false },
      quietLogger(),
    );

    const report = await runtime.scan();

    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toMatchObject({
      ruleId: "R007",
      kind: "clipped-content",
      severity: "high",
    });
    expect(report.applied).toEqual([]);
    expect(panel.hasAttribute("data-dsh-ui-repair-target")).toBe(false);
    expect(document.querySelector("[data-dsh-ui-repair-style]")).toBeNull();
  });

  it("applies, verifies, records, and rolls back an explicitly safe scroll repair", async () => {
    document.body.innerHTML = `
      <section data-dsh-ui-repair-root="fixture">
        <div id="panel" data-dsh-ui-repair-scroll></div>
        <div id="neighbor"></div>
      </section>
    `;
    const panel = document.querySelector("#panel") as HTMLElement;
    dimensions(panel, {
      clientHeight: 100,
      scrollHeight: 180,
      clientWidth: 200,
      scrollWidth: 200,
    });
    const runtime = new UIRepairRuntime(
      document,
      { mode: "auto", observeMutations: false },
      quietLogger(),
    );

    const report = await runtime.scan();
    const repairId = report.applied[0];

    expect(repairId).toBeDefined();
    expect(getComputedStyle(panel).overflowY).toBe("auto");
    expect(getComputedStyle(document.querySelector("#neighbor")!).overflowY).not.toBe(
      "auto",
    );
    expect(runtime.getHistory()[0]).toMatchObject({
      repairId,
      status: "verified",
    });
    expect(runtime.rollback(repairId!)).toBe(true);
    expect(panel.hasAttribute("data-dsh-ui-repair-target")).toBe(false);
    expect(document.querySelector("[data-dsh-ui-repair-style]")).toBeNull();
  });

  it("refuses to propose overflow writes around sticky descendants", async () => {
    document.body.innerHTML = `
      <section data-dsh-ui-repair-root="fixture">
        <div id="panel" data-dsh-ui-repair-scroll>
          <div style="position: sticky"></div>
        </div>
      </section>
    `;
    const panel = document.querySelector("#panel") as HTMLElement;
    dimensions(panel, {
      clientHeight: 100,
      scrollHeight: 180,
      clientWidth: 200,
      scrollWidth: 200,
    });
    const runtime = new UIRepairRuntime(
      document,
      { mode: "auto", observeMutations: false },
      quietLogger(),
    );

    const report = await runtime.scan();

    expect(report.issues[0]?.evidence.positionSensitiveDescendant).toBe(true);
    expect(report.issues[0]?.suggestedCss).toBeUndefined();
    expect(report.applied).toEqual([]);
  });

  it("keeps ignored issues visible while excluding them from auto repair", async () => {
    document.body.innerHTML = `
      <section data-dsh-ui-repair-root="fixture">
        <div id="intentional" data-dsh-ui-repair-scroll></div>
      </section>
    `;
    const panel = document.querySelector("#intentional") as HTMLElement;
    dimensions(panel, {
      clientHeight: 100,
      scrollHeight: 180,
      clientWidth: 200,
      scrollWidth: 200,
    });
    const runtime = new UIRepairRuntime(
      document,
      {
        mode: "auto",
        observeMutations: false,
        ignore: [{ rule: "R006", selector: "#intentional" }],
      },
      quietLogger(),
    );

    const report = await runtime.scan();

    expect(report.issues).toHaveLength(1);
    expect(report.ignored).toEqual([report.issues[0]?.id]);
    expect(report.applied).toEqual([]);
    expect(getComputedStyle(panel).overflowY).not.toBe("auto");
  });

  it("publishes completed scans to diagnostics subscribers", async () => {
    document.body.innerHTML = `
      <section data-dsh-ui-repair-root="fixture">
        <div id="panel"></div>
      </section>
    `;
    const panel = document.querySelector("#panel") as HTMLElement;
    dimensions(panel, {
      clientHeight: 100,
      scrollHeight: 180,
      clientWidth: 200,
      scrollWidth: 200,
    });
    const runtime = new UIRepairRuntime(
      document,
      { observeMutations: false },
      quietLogger(),
    );
    const listener = vi.fn();
    const unsubscribe = runtime.subscribe(listener);

    await runtime.scan();

    expect(runtime.getRevision()).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    await runtime.scan();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("repairs one icon outlier against the dominant repeated-row alignment", async () => {
    document.body.innerHTML = `
      <section data-dsh-ui-repair-root="fixture">
        <nav data-dsh-ui-repair-row-group>
          <button><svg id="a"></svg><span>A</span></button>
          <button><svg id="b"></svg><span>B</span></button>
          <button><svg id="outlier"></svg><span>C</span></button>
        </nav>
      </section>
    `;
    const rect = (x: number): DOMRect => ({
      x,
      y: 0,
      width: 16,
      height: 16,
      top: 0,
      right: x + 16,
      bottom: 16,
      left: x,
      toJSON: () => ({}),
    });
    for (const id of ["a", "b"]) {
      const icon = document.querySelector(`#${id}`) as SVGElement;
      vi.spyOn(icon, "getBoundingClientRect").mockReturnValue(rect(10));
    }
    const outlier = document.querySelector("#outlier") as SVGElement;
    vi.spyOn(outlier, "getBoundingClientRect").mockImplementation(() =>
      rect(outlier.hasAttribute("data-dsh-ui-repair-target") ? 10 : 6),
    );
    const runtime = new UIRepairRuntime(
      document,
      { mode: "auto", observeMutations: false },
      quietLogger(),
    );

    const report = await runtime.scan();

    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toMatchObject({
      ruleId: "R001",
      kind: "icon-alignment",
      suggestedCss: { translate: "4px 0" },
    });
    expect(report.applied).toHaveLength(1);
    expect(runtime.getHistory()[0]?.status).toBe("verified");

    runtime.dispose();
    expect(outlier.hasAttribute("data-dsh-ui-repair-target")).toBe(false);
  });

  it("automatically rolls a repair back when verification still sees the defect", async () => {
    document.body.innerHTML = `
      <section data-dsh-ui-repair-root="fixture">
        <nav data-dsh-ui-repair-row-group>
          <button><svg id="a"></svg></button>
          <button><svg id="b"></svg></button>
          <button><svg id="outlier"></svg></button>
        </nav>
      </section>
    `;
    const rect = (x: number): DOMRect => ({
      x,
      y: 0,
      width: 16,
      height: 16,
      top: 0,
      right: x + 16,
      bottom: 16,
      left: x,
      toJSON: () => ({}),
    });
    for (const id of ["a", "b"]) {
      vi.spyOn(
        document.querySelector(`#${id}`) as SVGElement,
        "getBoundingClientRect",
      ).mockReturnValue(rect(10));
    }
    const outlier = document.querySelector("#outlier") as SVGElement;
    vi.spyOn(outlier, "getBoundingClientRect").mockReturnValue(rect(5));
    const runtime = new UIRepairRuntime(
      document,
      { mode: "auto", observeMutations: false },
      quietLogger(),
    );

    const report = await runtime.scan();

    expect(report.applied).toHaveLength(1);
    expect(report.rolledBack).toEqual(report.applied);
    expect(runtime.getHistory()[0]?.status).toBe("verification-failed");
    expect(outlier.hasAttribute("data-dsh-ui-repair-target")).toBe(false);
    expect(document.querySelector("[data-dsh-ui-repair-style]")).toBeNull();
  });

  it("discovers a root added after startup through a targeted mutation scan", async () => {
    const runtime = new UIRepairRuntime(
      document,
      { mode: "observe", observeMutations: true },
      quietLogger(),
    );
    runtime.start();
    const root = document.createElement("section");
    root.setAttribute("data-dsh-ui-repair-root", "dynamic");
    const panel = document.createElement("div");
    root.append(panel);
    dimensions(panel, {
      clientHeight: 40,
      scrollHeight: 80,
      clientWidth: 100,
      scrollWidth: 100,
    });

    document.body.append(root);
    await vi.waitFor(() => {
      expect(runtime.getLatestReport()?.issues[0]?.kind).toBe(
        "unexpected-overflow-y",
      );
    });
    runtime.dispose();
  });
});
