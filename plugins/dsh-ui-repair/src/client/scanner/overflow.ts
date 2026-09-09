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

function scrollEnabled(value: string): boolean {
  return value === "auto" || value === "scroll";
}

function positionSensitiveDescendant(
  element: HTMLElement,
  limit: number,
): boolean {
  for (const child of collectElements(element, limit).slice(1)) {
    const position = computedStyle(child)?.position;
    if (position === "sticky" || position === "fixed") return true;
  }
  return false;
}

function nestedScrollOwner(element: HTMLElement, limit: number): boolean {
  for (const child of collectElements(element, limit).slice(1)) {
    const style = computedStyle(child);
    if (
      style !== undefined &&
      scrollEnabled(style.overflowY) &&
      child.scrollHeight > child.clientHeight + 1
    ) {
      return true;
    }
  }
  return false;
}

function clampConfidence(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

export function scanOverflow(
  root: HTMLElement,
  config: UIRepairConfig,
  createId: (ruleId: string, target: HTMLElement) => string,
): readonly RepairCandidate[] {
  const candidates: RepairCandidate[] = [];
  const plugin = inferPlugin(root);
  for (const element of collectElements(root, config.maxElementsPerRoot)) {
    if (element.clientHeight <= 0 || element.clientWidth <= 0) continue;
    const verticalExcess = element.scrollHeight - element.clientHeight;
    const horizontalExcess = element.scrollWidth - element.clientWidth;
    const style = computedStyle(element);
    if (style === undefined) continue;

    if (
      horizontalExcess > config.overflowTolerancePx &&
      !scrollEnabled(style.overflowX)
    ) {
      const explicit = element.hasAttribute("data-dsh-ui-repair-scroll-x");
      const sensitive = positionSensitiveDescendant(element, 80);
      const confidence = clampConfidence(
        0.73 +
          (explicit ? 0.2 : 0) +
          (!sensitive ? 0.04 : 0) +
          (verticalExcess <= config.overflowTolerancePx ? 0.03 : 0),
      );
      const repairable = explicit && !sensitive;
      const issue: RepairIssue = {
        id: createId("R005", element),
        ruleId: "R005",
        kind: "unexpected-overflow-x",
        severity: horizontalExcess >= 32 ? "high" : "medium",
        confidence,
        ...(plugin === undefined ? {} : { plugin }),
        root: describeElement(root),
        target: describeElement(element),
        evidence: {
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          horizontalExcess,
          verticalExcess,
          overflowX: style.overflowX,
          explicitSafeScrollTarget: explicit,
          positionSensitiveDescendant: sensitive,
        },
        ...(repairable ? { suggestedCss: { "overflow-x": "auto" } } : {}),
      };
      candidates.push({
        issue,
        root,
        target: element,
        verify: () => {
          const after = computedStyle(element);
          const afterVerticalExcess = element.scrollHeight - element.clientHeight;
          const ok =
            after !== undefined &&
            scrollEnabled(after.overflowX) &&
            afterVerticalExcess <= Math.max(0, verticalExcess);
          return {
            ok,
            reason: ok
              ? "horizontal content is reachable without new vertical overflow"
              : "horizontal scroll ownership was not established safely",
            evidence: {
              overflowX: after?.overflowX ?? "unavailable",
              verticalExcess: afterVerticalExcess,
            },
          };
        },
      });
    }

    if (
      verticalExcess <= config.overflowTolerancePx ||
      scrollEnabled(style.overflowY)
    ) {
      continue;
    }

    const explicit = element.hasAttribute("data-dsh-ui-repair-scroll");
    const sensitive = positionSensitiveDescendant(element, 80);
    const nested = nestedScrollOwner(element, 80);
    let confidence = 0.72;
    if (explicit) confidence += 0.18;
    if (!sensitive) confidence += 0.04;
    if (!nested) confidence += 0.03;
    if (horizontalExcess <= config.overflowTolerancePx) confidence += 0.03;
    confidence = clampConfidence(confidence);

    const parentDisplay =
      element.parentElement === null
        ? ""
        : computedStyle(element.parentElement)?.display ?? "";
    const suggestedCss: Record<string, string> = { "overflow-y": "auto" };
    if (parentDisplay.includes("flex") || parentDisplay.includes("grid")) {
      suggestedCss["min-height"] = "0px";
    }
    const repairable =
      !sensitive &&
      !nested &&
      horizontalExcess <= config.overflowTolerancePx &&
      (explicit || confidence >= 0.95);
    const ruleId = style.overflowY === "hidden" ? "R007" : "R006";
    const issue: RepairIssue = {
      id: createId(ruleId, element),
      ruleId,
      kind:
        style.overflowY === "hidden"
          ? "clipped-content"
          : "unexpected-overflow-y",
      severity: verticalExcess >= 32 ? "high" : "medium",
      confidence,
      ...(plugin === undefined ? {} : { plugin }),
      root: describeElement(root),
      target: describeElement(element),
      evidence: {
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        verticalExcess,
        horizontalExcess,
        overflowY: style.overflowY,
        explicitSafeScrollTarget: explicit,
        nestedScrollOwner: nested,
        positionSensitiveDescendant: sensitive,
      },
      ...(repairable ? { suggestedCss } : {}),
    };
    candidates.push({
      issue,
      root,
      target: element,
      verify: () => {
        const after = computedStyle(element);
        const afterHorizontalExcess = element.scrollWidth - element.clientWidth;
        const ok =
          after !== undefined &&
          scrollEnabled(after.overflowY) &&
          afterHorizontalExcess <= Math.max(0, horizontalExcess);
        return {
          ok,
          reason: ok
            ? "vertical content is reachable without new horizontal overflow"
            : "scroll ownership was not established safely",
          evidence: {
            overflowY: after?.overflowY ?? "unavailable",
            horizontalExcess: afterHorizontalExcess,
          },
        };
      },
    });
  }
  return candidates;
}
