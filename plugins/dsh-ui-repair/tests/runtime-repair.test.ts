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
    expect(
      runtime.getHistory().find(({ repairId }) => repairId === issue?.id),
    ).toMatchObject({ status: "verified" });
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
    expect(
      getComputedStyle(document.querySelector("#no-shrink")!).flexShrink,
    ).toBe("0");
    expect(
      getComputedStyle(document.querySelector("#min-zero")!).minWidth,
    ).toBe("0px");
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
    expect(
      relevant.every(({ suggestedCss }) => suggestedCss === undefined),
    ).toBe(true);
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
});
