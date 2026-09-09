import {
  collectElements,
  describeElement,
  inferPlugin,
} from "../dom.js";
import type {
  RepairCandidate,
  RepairIssue,
  UIRepairConfig,
} from "../types.js";

function computedStyle(element: HTMLElement): CSSStyleDeclaration | undefined {
  try {
    return element.ownerDocument.defaultView?.getComputedStyle(element);
  } catch {
    return undefined;
  }
}

function clampConfidence(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

function isFlex(display: string): boolean {
  return display === "flex" || display === "inline-flex";
}

function isFlexOrGrid(display: string): boolean {
  return isFlex(display) || display === "grid" || display === "inline-grid";
}

export function scanFlexConstraints(
  root: HTMLElement,
  config: UIRepairConfig,
  createId: (ruleId: string, target: HTMLElement) => string,
): readonly RepairCandidate[] {
  const result: RepairCandidate[] = [];
  const plugin = inferPlugin(root);
  for (const element of collectElements(root, config.maxElementsPerRoot)) {
    const parent = element.parentElement;
    if (parent === null || element.clientWidth <= 0) continue;
    const style = computedStyle(element);
    const parentStyle = computedStyle(parent);
    if (style === undefined || parentStyle === undefined) continue;
    const horizontalExcess = element.scrollWidth - element.clientWidth;
    if (horizontalExcess <= config.overflowTolerancePx) continue;

    if (isFlex(parentStyle.display) && Number(style.flexShrink || "1") > 0) {
      const explicit = element.hasAttribute("data-dsh-ui-repair-no-shrink");
      const confidence = clampConfidence(0.8 + (explicit ? 0.18 : 0));
      const issue: RepairIssue = {
        id: createId("R008", element),
        ruleId: "R008",
        kind: "flex-shrink-anomaly",
        severity: horizontalExcess >= 24 ? "medium" : "low",
        confidence,
        ...(plugin === undefined ? {} : { plugin }),
        root: describeElement(root),
        target: describeElement(element),
        evidence: {
          flexShrink: style.flexShrink || "1",
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          horizontalExcess,
          explicitNoShrinkTarget: explicit,
          parent: describeElement(parent),
        },
        ...(explicit ? { suggestedCss: { "flex-shrink": "0" } } : {}),
      };
      result.push({
        issue,
        root,
        target: element,
        verify: () => {
          const after = computedStyle(element);
          const afterExcess = element.scrollWidth - element.clientWidth;
          const ok =
            after !== undefined &&
            Number(after.flexShrink) === 0 &&
            afterExcess <= horizontalExcess;
          return {
            ok,
            reason: ok
              ? "flex item no longer permits unintended shrinking"
              : "flex shrink constraint did not stabilize the item",
            evidence: {
              flexShrink: after?.flexShrink ?? "unavailable",
              horizontalExcess: afterExcess,
            },
          };
        },
      });
    }

    if (
      isFlexOrGrid(parentStyle.display) &&
      style.minWidth !== "0px"
    ) {
      const explicit = element.hasAttribute(
        "data-dsh-ui-repair-min-width-zero",
      );
      const confidence = clampConfidence(0.8 + (explicit ? 0.18 : 0));
      const issue: RepairIssue = {
        id: createId("R009", element),
        ruleId: "R009",
        kind: "missing-min-width-zero",
        severity: horizontalExcess >= 24 ? "medium" : "low",
        confidence,
        ...(plugin === undefined ? {} : { plugin }),
        root: describeElement(root),
        target: describeElement(element),
        evidence: {
          minWidth: style.minWidth || "auto",
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          horizontalExcess,
          explicitMinWidthTarget: explicit,
          parent: describeElement(parent),
          parentDisplay: parentStyle.display,
        },
        ...(explicit ? { suggestedCss: { "min-width": "0px" } } : {}),
      };
      result.push({
        issue,
        root,
        target: element,
        verify: () => {
          const after = computedStyle(element);
          const afterExcess = element.scrollWidth - element.clientWidth;
          const ok =
            after?.minWidth === "0px" && afterExcess <= horizontalExcess;
          return {
            ok,
            reason: ok
              ? "flex/grid item can shrink below its intrinsic content width"
              : "min-width constraint was not applied safely",
            evidence: {
              minWidth: after?.minWidth ?? "unavailable",
              horizontalExcess: afterExcess,
            },
          };
        },
      });
    }
  }
  return result;
}
