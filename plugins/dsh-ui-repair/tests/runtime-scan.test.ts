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
    expect(
      getComputedStyle(document.querySelector("#neighbor")!).overflowY,
    ).not.toBe("auto");
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
});
