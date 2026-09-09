import {
  collectElements,
  describeElement,
  inferPlugin,
  matches,
} from "../dom.js";
import type {
  RepairCandidate,
  RepairIssue,
  UIRepairConfig,
} from "../types.js";

const TEXT_SELECTOR = [
  "a",
  "button",
  "label",
  "p",
  "span",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "[role='heading']",
  "[data-dsh-ui-repair-text]",
].join(",");

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

function textConstrained(style: CSSStyleDeclaration): boolean {
  return (
    style.overflow === "hidden" ||
    style.overflow === "clip" ||
    style.overflowX === "hidden" ||
    style.overflowX === "clip" ||
    style.textOverflow === "ellipsis" ||
    style.textOverflow === "clip" ||
    style.whiteSpace === "nowrap"
  );
}

export function scanTextOverflow(
  root: HTMLElement,
  config: UIRepairConfig,
  createId: (ruleId: string, target: HTMLElement) => string,
): readonly RepairCandidate[] {
  const result: RepairCandidate[] = [];
  const plugin = inferPlugin(root);
  for (const element of collectElements(root, config.maxElementsPerRoot)) {
    if (!matches(element, TEXT_SELECTOR)) continue;
    if ((element.textContent?.trim().length ?? 0) === 0) continue;
    if (element.clientWidth <= 0 || element.clientHeight <= 0) continue;
    const horizontalExcess = element.scrollWidth - element.clientWidth;
    const verticalExcess = element.scrollHeight - element.clientHeight;
    if (
      horizontalExcess <= config.overflowTolerancePx &&
      verticalExcess <= config.overflowTolerancePx
    ) {
      continue;
    }
    const style = computedStyle(element);
    if (style === undefined) continue;
    const explicit = element.hasAttribute("data-dsh-ui-repair-text-wrap");
    const constrained = textConstrained(style);
    if (!explicit && !constrained) continue;
    const horizontalOnly =
      horizontalExcess > config.overflowTolerancePx &&
      verticalExcess <= config.overflowTolerancePx;
    const repairable = explicit && horizontalOnly;
    const confidence = clampConfidence(
      0.72 +
        (explicit ? 0.22 : 0) +
        (constrained ? 0.03 : 0) +
        (horizontalOnly ? 0.03 : 0),
    );
    const issue: RepairIssue = {
      id: createId("R012", element),
      ruleId: "R012",
      kind: "text-overflow",
      severity:
        Math.max(horizontalExcess, verticalExcess) >= 24 ? "medium" : "low",
      confidence,
      ...(plugin === undefined ? {} : { plugin }),
      root: describeElement(root),
      target: describeElement(element),
      evidence: {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        horizontalExcess,
        verticalExcess,
        whiteSpace: style.whiteSpace,
        overflow: style.overflow,
        overflowX: style.overflowX,
        textOverflow: style.textOverflow,
        explicitTextWrapTarget: explicit,
      },
      ...(repairable
        ? {
            suggestedCss: {
              "white-space": "normal",
              "overflow-wrap": "anywhere",
            },
          }
        : {}),
    };
    result.push({
      issue,
      root,
      target: element,
      verify: () => {
        const afterHorizontalExcess = element.scrollWidth - element.clientWidth;
        const afterStyle = computedStyle(element);
        const ok =
          afterStyle?.whiteSpace === "normal" &&
          afterStyle.overflowWrap === "anywhere" &&
          afterHorizontalExcess <= config.overflowTolerancePx;
        return {
          ok,
          reason: ok
            ? "text fits after safe wrapping"
            : "text remains horizontally clipped after wrapping",
          evidence: {
            horizontalExcess: afterHorizontalExcess,
            whiteSpace: afterStyle?.whiteSpace ?? "unavailable",
            overflowWrap: afterStyle?.overflowWrap ?? "unavailable",
          },
        };
      },
    });
  }
  return result;
}

interface OutsideEdges {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

function outsideEdges(element: DOMRect, parent: DOMRect): OutsideEdges {
  return {
    left: Math.max(0, parent.left - element.left),
    right: Math.max(0, element.right - parent.right),
    top: Math.max(0, parent.top - element.top),
    bottom: Math.max(0, element.bottom - parent.bottom),
  };
}

function visibleRatio(element: DOMRect, parent: DOMRect): number {
  const width = Math.max(
    0,
    Math.min(element.right, parent.right) - Math.max(element.left, parent.left),
  );
  const height = Math.max(
    0,
    Math.min(element.bottom, parent.bottom) - Math.max(element.top, parent.top),
  );
  const area = element.width * element.height;
  return area <= 0 ? 0 : Math.round((width * height / area) * 100) / 100;
}

export function scanOutsideParent(
  root: HTMLElement,
  config: UIRepairConfig,
  createId: (ruleId: string, target: HTMLElement) => string,
): readonly RepairCandidate[] {
  const result: RepairCandidate[] = [];
  const plugin = inferPlugin(root);
  for (const element of collectElements(root, config.maxElementsPerRoot)) {
    const parent = element.parentElement;
    if (parent === null || element === root || !root.contains(parent)) continue;
    const rect = element.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      parentRect.width <= 0 ||
      parentRect.height <= 0
    ) {
      continue;
    }
    const edges = outsideEdges(rect, parentRect);
    const maxOutside = Math.max(edges.left, edges.right, edges.top, edges.bottom);
    if (maxOutside <= config.overflowTolerancePx) continue;
    const style = computedStyle(element);
    if (style === undefined) continue;
    const explicit = element.hasAttribute("data-dsh-ui-repair-contain");
    const horizontalOnly =
      Math.max(edges.left, edges.right) > config.overflowTolerancePx &&
      Math.max(edges.top, edges.bottom) <= config.overflowTolerancePx;
    const positionSafe =
      style.position === "" ||
      style.position === "static" ||
      style.position === "relative";
    const hasTranslation =
      (style.translate !== "" && style.translate !== "none") ||
      (style.transform !== "" && style.transform !== "none");
    let suggestedCss: Readonly<Record<string, string>> | undefined;
    if (explicit && horizontalOnly && positionSafe && !hasTranslation) {
      if (
        rect.width > parentRect.width + config.overflowTolerancePx &&
        edges.left <= config.overflowTolerancePx
      ) {
        suggestedCss = { "max-width": "100%" };
      } else if (rect.width <= parentRect.width + config.overflowTolerancePx) {
        const delta = edges.left > config.overflowTolerancePx
          ? edges.left
          : -edges.right;
        suggestedCss = {
          translate: `${Math.round(delta * 100) / 100}px 0`,
        };
      }
    }
    const ratio = visibleRatio(rect, parentRect);
    const confidence = clampConfidence(
      0.72 +
        (explicit ? 0.22 : 0) +
        (positionSafe ? 0.03 : 0) +
        (horizontalOnly ? 0.03 : 0),
    );
    const issue: RepairIssue = {
      id: createId("R013", element),
      ruleId: "R013",
      kind: "element-outside-parent",
      severity: ratio < 0.8 ? "high" : maxOutside >= 8 ? "medium" : "low",
      confidence,
      ...(plugin === undefined ? {} : { plugin }),
      root: describeElement(root),
      target: describeElement(element),
      evidence: {
        parent: describeElement(parent),
        visibleRatio: ratio,
        outside: edges,
        position: style.position || "static",
        explicitContainTarget: explicit,
        hasExistingTranslation: hasTranslation,
      },
      ...(suggestedCss === undefined ? {} : { suggestedCss }),
    };
    result.push({
      issue,
      root,
      target: element,
      verify: () => {
        const actual = element.getBoundingClientRect();
        const owner = parent.getBoundingClientRect();
        const after = outsideEdges(actual, owner);
        const error = Math.max(after.left, after.right, after.top, after.bottom);
        const ok = error <= config.overflowTolerancePx;
        return {
          ok,
          reason: ok
            ? "element fits within its parent bounds"
            : "element remains outside its parent bounds",
          evidence: { outside: after, maxOutside: error },
        };
      },
    });
  }
  return result;
}
