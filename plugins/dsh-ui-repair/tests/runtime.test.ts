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

  it("manually applies a suggested repair through the same verification path", async () => {
    document.body.innerHTML = `
      <section data-dsh-ui-repair-root="fixture">
        <div id="panel" data-dsh-ui-repair-scroll></div>
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
      { mode: "suggest", observeMutations: false },
      quietLogger(),
    );
    const report = await runtime.scan();

    expect(report.applied).toEqual([]);
    expect(await runtime.apply(report.issues[0]!.id)).toBe(true);
    expect(getComputedStyle(panel).overflowY).toBe("auto");
    expect(runtime.getLatestReport()?.applied).toEqual([report.issues[0]!.id]);
    expect(runtime.getHistory()[0]?.status).toBe("verified");
  });

  it("revalidates and refuses a stale manual suggestion", async () => {
    document.body.innerHTML = `
      <section data-dsh-ui-repair-root="fixture">
        <div id="panel" data-dsh-ui-repair-scroll></div>
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
      { mode: "suggest", observeMutations: false },
      quietLogger(),
    );
    const report = await runtime.scan();
    dimensions(panel, {
      clientHeight: 100,
      scrollHeight: 100,
      clientWidth: 200,
      scrollWidth: 200,
    });

    expect(await runtime.apply(report.issues[0]!.id)).toBe(false);
    expect(runtime.getHistory()).toEqual([]);
    expect(document.querySelector("[data-dsh-ui-repair-style]")).toBeNull();
  });

  it("repairs an explicitly safe horizontal scroll owner", async () => {
    document.body.innerHTML = `
      <section data-dsh-ui-repair-root="fixture">
        <div id="panel" data-dsh-ui-repair-scroll-x></div>
      </section>
    `;
    const panel = document.querySelector("#panel") as HTMLElement;
    dimensions(panel, {
      clientHeight: 100,
      scrollHeight: 100,
      clientWidth: 200,
      scrollWidth: 260,
    });
    const runtime = new UIRepairRuntime(
      document,
      { mode: "auto", observeMutations: false },
      quietLogger(),
    );

    const report = await runtime.scan();
    const issue = report.issues.find(({ ruleId }) => ruleId === "R005");

    expect(issue).toMatchObject({
      kind: "unexpected-overflow-x",
      confidence: 1,
      suggestedCss: { "overflow-x": "auto" },
    });
    expect(report.applied).toContain(issue?.id);
    expect(getComputedStyle(panel).overflowX).toBe("auto");
  });

  it("normalizes one explicit icon-size outlier", async () => {
    document.body.innerHTML = `
      <section data-dsh-ui-repair-root="fixture">
        <nav data-dsh-ui-repair-row-group>
          <button><svg id="a"></svg></button>
          <button><svg id="b"></svg></button>
          <button><svg id="outlier"></svg></button>
        </nav>
      </section>
    `;
    const rect = (width: number): DOMRect => ({
      x: 10,
      y: 0,
      width,
      height: width,
      top: 0,
      right: 10 + width,
      bottom: width,
      left: 10,
      toJSON: () => ({}),
    });
    for (const id of ["a", "b"]) {
      vi.spyOn(
        document.querySelector(`#${id}`) as SVGElement,
        "getBoundingClientRect",
      ).mockReturnValue(rect(16));
    }
    const outlier = document.querySelector("#outlier") as SVGElement;
    vi.spyOn(outlier, "getBoundingClientRect").mockImplementation(() =>
      rect(outlier.hasAttribute("data-dsh-ui-repair-target") ? 16 : 12),
    );
    const runtime = new UIRepairRuntime(
      document,
      { mode: "auto", observeMutations: false },
      quietLogger(),
    );

    const report = await runtime.scan();
    const issue = report.issues.find(({ ruleId }) => ruleId === "R002");

    expect(issue).toMatchObject({
      kind: "icon-size-consistency",
      suggestedCss: { width: "16px", height: "16px" },
    });
    expect(report.applied).toContain(issue?.id);
    expect(runtime.getHistory().find(({ repairId }) => repairId === issue?.id))
      .toMatchObject({ status: "verified" });
  });

  it("repairs explicit flex-shrink and min-width constraints", async () => {
    document.body.innerHTML = `
      <section data-dsh-ui-repair-root="fixture">
        <div style="display:flex">
          <div id="no-shrink" data-dsh-ui-repair-no-shrink></div>
          <div id="min-zero" data-dsh-ui-repair-min-width-zero style="flex-shrink:0"></div>
        </div>
      </section>
    `;
    for (const id of ["no-shrink", "min-zero"]) {
      dimensions(document.querySelector(`#${id}`) as HTMLElement, {
        clientHeight: 20,
        scrollHeight: 20,
        clientWidth: 40,
        scrollWidth: 80,
      });
    }
    const runtime = new UIRepairRuntime(
      document,
      { mode: "auto", observeMutations: false },
      quietLogger(),
    );

    const report = await runtime.scan();
    const shrink = report.issues.find(({ ruleId }) => ruleId === "R008");
    const minWidth = report.issues.find(
      ({ ruleId, target }) => ruleId === "R009" && target === "#min-zero",
    );

    expect(shrink?.suggestedCss).toEqual({ "flex-shrink": "0" });
    expect(minWidth?.suggestedCss).toEqual({ "min-width": "0px" });
    expect(report.applied).toEqual(
      expect.arrayContaining([shrink?.id, minWidth?.id]),
    );
    expect(getComputedStyle(document.querySelector("#no-shrink")!).flexShrink)
      .toBe("0");
    expect(getComputedStyle(document.querySelector("#min-zero")!).minWidth)
      .toBe("0px");
  });

  it("keeps ambiguous horizontal and flex ownership diagnosis-only", async () => {
    document.body.innerHTML = `
      <section data-dsh-ui-repair-root="fixture">
        <div style="display:flex"><div id="ambiguous"></div></div>
      </section>
    `;
    const item = document.querySelector("#ambiguous") as HTMLElement;
    dimensions(item, {
      clientHeight: 20,
      scrollHeight: 20,
      clientWidth: 40,
      scrollWidth: 80,
    });
    const runtime = new UIRepairRuntime(
      document,
      { mode: "auto", observeMutations: false },
      quietLogger(),
    );

    const report = await runtime.scan();
    const relevant = report.issues.filter(({ ruleId }) =>
      ["R005", "R008", "R009"].includes(ruleId),
    );

    expect(relevant.map(({ ruleId }) => ruleId)).toEqual([
      "R005",
      "R008",
      "R009",
    ]);
    expect(relevant.every(({ suggestedCss }) => suggestedCss === undefined))
      .toBe(true);
    expect(report.applied).toEqual([]);
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

  it("repairs explicit horizontal and vertical row outliers", async () => {
    document.body.innerHTML = `
      <main data-plugin-package="@example/rows">
        <section data-dsh-ui-repair-root="rows">
          <nav data-dsh-ui-repair-row-group id="horizontal">
            <button id="x-a"></button>
            <button id="x-b"></button>
            <button id="x-out"></button>
          </nav>
          <nav data-dsh-ui-repair-row-group id="vertical">
            <button id="h-a"></button>
            <button id="h-b"></button>
            <button id="h-out" data-dsh-ui-repair-row-height></button>
          </nav>
        </section>
      </main>
    `;
    const rowRect = (x: number, height: number): DOMRect => ({
      x,
      y: 0,
      width: 100,
      height,
      top: 0,
      right: x + 100,
      bottom: height,
      left: x,
      toJSON: () => ({}),
    });
    for (const id of ["x-a", "x-b"]) {
      vi.spyOn(
        document.querySelector(`#${id}`) as HTMLElement,
        "getBoundingClientRect",
      ).mockReturnValue(rowRect(10, 32));
    }
    const horizontalOutlier = document.querySelector("#x-out") as HTMLElement;
    vi.spyOn(horizontalOutlier, "getBoundingClientRect").mockImplementation(
      () => rowRect(
        horizontalOutlier.hasAttribute("data-dsh-ui-repair-target") ? 10 : 16,
        32,
      ),
    );
    for (const id of ["h-a", "h-b"]) {
      vi.spyOn(
        document.querySelector(`#${id}`) as HTMLElement,
        "getBoundingClientRect",
      ).mockReturnValue(rowRect(20, 32));
    }
    const verticalOutlier = document.querySelector("#h-out") as HTMLElement;
    vi.spyOn(verticalOutlier, "getBoundingClientRect").mockImplementation(() =>
      rowRect(
        20,
        verticalOutlier.hasAttribute("data-dsh-ui-repair-target") ? 32 : 24,
      ),
    );
    const runtime = new UIRepairRuntime(
      document,
      {
        mode: "auto",
        observeMutations: false,
        observeResize: false,
      },
      quietLogger(),
    );

    const report = await runtime.scan();
    const horizontal = report.issues.find(({ ruleId }) => ruleId === "R003");
    const vertical = report.issues.find(({ ruleId }) => ruleId === "R004");

    expect(horizontal).toMatchObject({
      plugin: "@example/rows",
      kind: "row-horizontal-alignment",
      suggestedCss: { translate: "-6px 0" },
    });
    expect(vertical).toMatchObject({
      plugin: "@example/rows",
      kind: "row-vertical-alignment",
      suggestedCss: { height: "32px" },
    });
    expect(report.applied).toEqual(
      expect.arrayContaining([horizontal?.id, vertical?.id]),
    );
    expect(report.rolledBack).toEqual([]);
  });

  it("rescans bounded roots after ResizeObserver notifications", async () => {
    document.body.innerHTML = Array.from(
      { length: 85 },
      (_value, index) => `
        <section data-dsh-ui-repair-root="resizable-${index}">
          ${index === 0 ? '<div id="panel"></div>' : ""}
        </section>
      `,
    ).join("");
    const root = document.querySelector(
      "[data-dsh-ui-repair-root]",
    ) as HTMLElement;
    const panel = document.querySelector("#panel") as HTMLElement;
    dimensions(panel, {
      clientHeight: 40,
      scrollHeight: 80,
      clientWidth: 100,
      scrollWidth: 100,
    });
    let resizeCallback:
      | ((entries: ResizeObserverEntry[], observer: ResizeObserver) => void)
      | undefined;
    const observe = vi.fn();
    const unobserve = vi.fn();
    const disconnect = vi.fn();
    class FakeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }

      observe = observe;
      unobserve = unobserve;
      disconnect = disconnect;
    }
    const original = window.ResizeObserver;
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      value: FakeResizeObserver,
    });
    try {
      const runtime = new UIRepairRuntime(
        document,
        {
          scanOnStartup: false,
          observeMutations: false,
          observeResize: true,
        },
        quietLogger(),
      );
      runtime.start();

      expect(observe).toHaveBeenCalledTimes(80);
      expect(observe).toHaveBeenCalledWith(root);
      resizeCallback?.(
        [{ target: root } as unknown as ResizeObserverEntry],
        {} as ResizeObserver,
      );
      await vi.waitFor(() => {
        expect(runtime.getLatestReport()?.issues[0]?.ruleId).toBe("R006");
      });

      runtime.dispose();
      expect(disconnect).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "ResizeObserver", {
        configurable: true,
        value: original,
      });
    }
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
