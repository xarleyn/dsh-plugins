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

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x,
    y,
    width,
    height,
    top: y,
    right: x + width,
    bottom: y + height,
    left: x,
    toJSON: () => ({}),
  };
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
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("spacing and containment rules", () => {
  it("normalizes an explicitly owned icon-to-label gap outlier", async () => {
    document.body.innerHTML = `
      <section data-dsh-ui-repair-root="fixture">
        <nav data-dsh-ui-repair-row-group>
          <button id="row-a" style="display:flex"><svg></svg><span>A</span></button>
          <button id="row-b" style="display:flex"><svg></svg><span>B</span></button>
          <button id="row-out" data-dsh-ui-repair-gap style="display:flex"><svg></svg><span>C</span></button>
        </nav>
      </section>
    `;
    for (const rowId of ["row-a", "row-b", "row-out"]) {
      const row = document.querySelector(`#${rowId}`) as HTMLElement;
      const icon = row.querySelector("svg") as SVGElement;
      const label = row.querySelector("span") as HTMLElement;
      vi.spyOn(icon, "getBoundingClientRect").mockReturnValue(
        rect(10, 0, 16, 16),
      );
      vi.spyOn(label, "getBoundingClientRect").mockImplementation(() =>
        rect(
          rowId === "row-out" &&
            !row.hasAttribute("data-dsh-ui-repair-target")
            ? 30
            : 34,
          0,
          40,
          16,
        ),
      );
    }
    const runtime = new UIRepairRuntime(
      document,
      { mode: "auto", observeMutations: false, observeResize: false },
      quietLogger(),
    );

    const report = await runtime.scan();
    const issue = report.issues.find(({ ruleId }) => ruleId === "R010");

    expect(issue).toMatchObject({
      kind: "inconsistent-gap",
      suggestedCss: { "column-gap": "8px" },
    });
    expect(report.applied).toContain(issue?.id);
    expect(report.rolledBack).toEqual([]);
  });

  it("normalizes explicitly owned padding against repeated peers", async () => {
    document.head.insertAdjacentHTML(
      "beforeend",
      `<style>
        .padding-row { padding: 8px 12px; }
        .padding-bad { padding-left: 4px; }
      </style>`,
    );
    document.body.innerHTML = `
      <section data-dsh-ui-repair-root="fixture">
        <nav data-dsh-ui-repair-row-group>
          <button class="padding-row" id="pad-a">A</button>
          <button class="padding-row" id="pad-b">B</button>
          <button class="padding-row padding-bad" id="pad-out" data-dsh-ui-repair-padding>C</button>
        </nav>
      </section>
    `;
    for (const id of ["pad-a", "pad-b", "pad-out"]) {
      vi.spyOn(
        document.querySelector(`#${id}`) as HTMLElement,
        "getBoundingClientRect",
      ).mockReturnValue(rect(10, 0, 100, 32));
    }
    const runtime = new UIRepairRuntime(
      document,
      { mode: "auto", observeMutations: false, observeResize: false },
      quietLogger(),
    );

    const report = await runtime.scan();
    const issue = report.issues.find(({ ruleId }) => ruleId === "R011");

    expect(issue?.suggestedCss).toEqual({
      "padding-top": "8px",
      "padding-right": "12px",
      "padding-bottom": "8px",
      "padding-left": "12px",
    });
    expect(report.applied).toContain(issue?.id);
    expect(getComputedStyle(document.querySelector("#pad-out")!).paddingLeft)
      .toBe("12px");
  });

  it("wraps explicitly owned clipped text and verifies the new geometry", async () => {
    document.head.insertAdjacentHTML(
      "beforeend",
      `<style>.clipped-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }</style>`,
    );
    document.body.innerHTML = `
      <section data-dsh-ui-repair-root="fixture">
        <span id="label" class="clipped-label" data-dsh-ui-repair-text-wrap>Long plugin label</span>
      </section>
    `;
    const label = document.querySelector("#label") as HTMLElement;
    Object.defineProperties(label, {
      clientHeight: { configurable: true, value: 20 },
      scrollHeight: { configurable: true, value: 20 },
      clientWidth: { configurable: true, value: 100 },
      scrollWidth: {
        configurable: true,
        get: () => label.hasAttribute("data-dsh-ui-repair-target") ? 100 : 160,
      },
    });
    const runtime = new UIRepairRuntime(
      document,
      { mode: "auto", observeMutations: false, observeResize: false },
      quietLogger(),
    );

    const report = await runtime.scan();
    const issue = report.issues.find(({ ruleId }) => ruleId === "R012");

    expect(issue).toMatchObject({
      kind: "text-overflow",
      confidence: 1,
      suggestedCss: {
        "white-space": "normal",
        "overflow-wrap": "anywhere",
      },
    });
    expect(report.applied).toContain(issue?.id);
    expect(report.rolledBack).toEqual([]);
  });

  it("contains an explicitly owned oversized child", async () => {
    document.body.innerHTML = `
      <section data-dsh-ui-repair-root="fixture">
        <div id="parent"><div id="child" data-dsh-ui-repair-contain></div></div>
      </section>
    `;
    const parent = document.querySelector("#parent") as HTMLElement;
    const child = document.querySelector("#child") as HTMLElement;
    vi.spyOn(parent, "getBoundingClientRect").mockReturnValue(
      rect(0, 0, 100, 50),
    );
    vi.spyOn(child, "getBoundingClientRect").mockImplementation(() =>
      rect(
        0,
        0,
        child.hasAttribute("data-dsh-ui-repair-target") ? 100 : 130,
        30,
      ),
    );
    const runtime = new UIRepairRuntime(
      document,
      { mode: "auto", observeMutations: false, observeResize: false },
      quietLogger(),
    );

    const report = await runtime.scan();
    const issue = report.issues.find(({ ruleId }) => ruleId === "R013");

    expect(issue).toMatchObject({
      kind: "element-outside-parent",
      confidence: 1,
      suggestedCss: { "max-width": "100%" },
    });
    expect(report.applied).toContain(issue?.id);
    expect(report.rolledBack).toEqual([]);
  });

  it("keeps unowned anomalies diagnosis-only", async () => {
    document.body.innerHTML = `
      <section data-dsh-ui-repair-root="fixture">
        <span id="label" style="white-space:nowrap;overflow:hidden">Long label</span>
        <div id="parent"><div id="child"></div></div>
      </section>
    `;
    const label = document.querySelector("#label") as HTMLElement;
    dimensions(label, {
      clientHeight: 20,
      scrollHeight: 20,
      clientWidth: 60,
      scrollWidth: 120,
    });
    const parent = document.querySelector("#parent") as HTMLElement;
    const child = document.querySelector("#child") as HTMLElement;
    vi.spyOn(parent, "getBoundingClientRect").mockReturnValue(
      rect(0, 0, 100, 50),
    );
    vi.spyOn(child, "getBoundingClientRect").mockReturnValue(
      rect(0, 0, 130, 30),
    );
    const runtime = new UIRepairRuntime(
      document,
      { mode: "auto", observeMutations: false, observeResize: false },
      quietLogger(),
    );

    const report = await runtime.scan();
    const issues = report.issues.filter(({ ruleId }) =>
      ruleId === "R012" || ruleId === "R013",
    );

    expect(issues.map(({ ruleId }) => ruleId)).toEqual(["R012", "R013"]);
    expect(issues.every(({ suggestedCss }) => suggestedCss === undefined))
      .toBe(true);
    expect(report.applied).toEqual([]);
  });
});
