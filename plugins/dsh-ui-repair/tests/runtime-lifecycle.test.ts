// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { UIRepairRuntime } from "../src/client/runtime.js";
import { dimensions, quietLogger } from "./runtime.helpers.js";

afterEach(() => {
  document.head
    .querySelectorAll("[data-dsh-ui-repair-style]")
    .forEach((element) => element.remove());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("UIRepairRuntime", () => {
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
      () =>
        rowRect(
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
