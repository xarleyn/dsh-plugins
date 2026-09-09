import {
  collectElements,
  describeElement,
  inferPlugin,
  matches,
} from "../dom.js";
import { dominantPosition } from "../geometry.js";
import type {
  RepairCandidate,
  RepairIssue,
  UIRepairConfig,
} from "../types.js";

const ROW_SELECTOR =
  "button,a,li,[role='menuitem'],[role='tab'],[data-dsh-ui-repair-row]";
const ICON_SELECTOR =
  "svg,img,[data-icon],[class*='icon' i],[data-dsh-ui-repair-icon]";

function computedStyle(element: HTMLElement): CSSStyleDeclaration | undefined {
  try {
    return element.ownerDocument.defaultView?.getComputedStyle(element);
  } catch {
    return undefined;
  }
}

function directRows(parent: HTMLElement): readonly HTMLElement[] {
  return Array.from(parent.children).filter((child) =>
    matches(child, ROW_SELECTOR),
  ) as HTMLElement[];
}

function cssPixel(value: number): string {
  return `${Math.round(value * 100) / 100}px`;
}

interface GapMeasurement {
  readonly row: HTMLElement;
  readonly gap: number;
}

function measureGap(row: HTMLElement): GapMeasurement | undefined {
  const icon = row.querySelector(ICON_SELECTOR) as HTMLElement | null;
  if (icon === null) return undefined;
  const explicitLabel = row.querySelector(
    "[data-dsh-ui-repair-label]",
  ) as HTMLElement | null;
  const label = explicitLabel ?? Array.from(row.children).find(
    (child) => child !== icon && (child.textContent?.trim().length ?? 0) > 0,
  ) as HTMLElement | undefined;
  if (label === undefined || label === null) return undefined;
  const iconRect = icon.getBoundingClientRect();
  const labelRect = label.getBoundingClientRect();
  if (iconRect.width <= 0 || labelRect.width <= 0) return undefined;
  const gap = Math.round((labelRect.left - iconRect.right) * 100) / 100;
  if (gap < -16 || gap > 96) return undefined;
  return { row, gap };
}

export function scanGapConsistency(
  root: HTMLElement,
  config: UIRepairConfig,
  createId: (ruleId: string, target: HTMLElement) => string,
): readonly RepairCandidate[] {
  const result: RepairCandidate[] = [];
  const plugin = inferPlugin(root);
  for (const parent of collectElements(root, config.maxElementsPerRoot)) {
    const measurements = directRows(parent)
      .map(measureGap)
      .filter((value): value is GapMeasurement => value !== undefined);
    if (measurements.length < 3) continue;
    const dominant = dominantPosition(
      measurements.map(({ gap }) => gap),
      1,
    );
    const outliers = measurements.filter(
      ({ gap }) => Math.abs(gap - dominant.center) > 1,
    );
    if (outliers.length === 0 || outliers.length >= measurements.length / 2) {
      continue;
    }
    const explicitGroup = parent.hasAttribute("data-dsh-ui-repair-row-group");
    const clusterRatio = dominant.members / measurements.length;
    for (const measurement of outliers) {
      const style = computedStyle(measurement.row);
      const explicitTarget = measurement.row.hasAttribute(
        "data-dsh-ui-repair-gap",
      );
      const layoutSupportsGap =
        style?.display === "flex" ||
        style?.display === "inline-flex" ||
        style?.display === "grid" ||
        style?.display === "inline-grid";
      const repairable =
        explicitTarget && layoutSupportsGap && dominant.center >= 0;
      const confidence = Math.min(
        1,
        Math.round(
          (0.77 +
            clusterRatio * 0.12 +
            (outliers.length === 1 ? 0.04 : 0) +
            (explicitGroup ? 0.03 : 0) +
            (repairable ? 0.04 : 0)) *
            100,
        ) / 100,
      );
      const issue: RepairIssue = {
        id: createId("R010", measurement.row),
        ruleId: "R010",
        kind: "inconsistent-gap",
        severity: Math.abs(measurement.gap - dominant.center) >= 4
          ? "medium"
          : "low",
        confidence,
        ...(plugin === undefined ? {} : { plugin }),
        root: describeElement(root),
        target: describeElement(measurement.row),
        evidence: {
          group: describeElement(parent),
          expectedGap: dominant.center,
          actualGap: measurement.gap,
          groupSize: measurements.length,
          dominantMembers: dominant.members,
          explicitGapTarget: explicitTarget,
          display: style?.display ?? "unavailable",
        },
        ...(repairable
          ? { suggestedCss: { "column-gap": cssPixel(dominant.center) } }
          : {}),
      };
      result.push({
        issue,
        root,
        target: measurement.row,
        verify: () => {
          const actualGap = measureGap(measurement.row)?.gap;
          const error =
            actualGap === undefined
              ? Number.POSITIVE_INFINITY
              : Math.abs(actualGap - dominant.center);
          const ok = error <= 1;
          return {
            ok,
            reason: ok
              ? "icon-to-label gap joined the dominant group"
              : "icon-to-label gap remains inconsistent",
            evidence: {
              expectedGap: dominant.center,
              actualGap: actualGap ?? "unavailable",
              error,
            },
          };
        },
      });
    }
  }
  return result;
}

interface PaddingMeasurement {
  readonly row: HTMLElement;
  readonly values: readonly [number, number, number, number];
}

function measurePadding(row: HTMLElement): PaddingMeasurement | undefined {
  const style = computedStyle(row);
  if (style === undefined) return undefined;
  const values = [
    Number.parseFloat(style.paddingTop),
    Number.parseFloat(style.paddingRight),
    Number.parseFloat(style.paddingBottom),
    Number.parseFloat(style.paddingLeft),
  ] as const;
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    return undefined;
  }
  return { row, values };
}

export function scanPaddingConsistency(
  root: HTMLElement,
  config: UIRepairConfig,
  createId: (ruleId: string, target: HTMLElement) => string,
): readonly RepairCandidate[] {
  const result: RepairCandidate[] = [];
  const plugin = inferPlugin(root);
  for (const parent of collectElements(root, config.maxElementsPerRoot)) {
    const measurements = directRows(parent)
      .map(measurePadding)
      .filter((value): value is PaddingMeasurement => value !== undefined);
    if (measurements.length < 3) continue;
    const dominant = [0, 1, 2, 3].map((index) =>
      dominantPosition(
        measurements.map(({ values }) => values[index]!),
        0.5,
      ),
    );
    const outliers = measurements.filter(({ values }) =>
      values.some(
        (value, index) => Math.abs(value - dominant[index]!.center) > 0.5,
      ),
    );
    if (outliers.length === 0 || outliers.length >= measurements.length / 2) {
      continue;
    }
    const explicitGroup = parent.hasAttribute("data-dsh-ui-repair-row-group");
    const dominantMembers = Math.min(...dominant.map(({ members }) => members));
    const expected = dominant.map(({ center }) => center) as [
      number,
      number,
      number,
      number,
    ];
    for (const measurement of outliers) {
      const explicitTarget = measurement.row.hasAttribute(
        "data-dsh-ui-repair-padding",
      );
      const confidence = Math.min(
        1,
        Math.round(
          (0.77 +
            (dominantMembers / measurements.length) * 0.12 +
            (outliers.length === 1 ? 0.04 : 0) +
            (explicitGroup ? 0.03 : 0) +
            (explicitTarget ? 0.04 : 0)) *
            100,
        ) / 100,
      );
      const issue: RepairIssue = {
        id: createId("R011", measurement.row),
        ruleId: "R011",
        kind: "inconsistent-padding",
        severity: measurement.values.some(
          (value, index) => Math.abs(value - expected[index]!) >= 4,
        )
          ? "medium"
          : "low",
        confidence,
        ...(plugin === undefined ? {} : { plugin }),
        root: describeElement(root),
        target: describeElement(measurement.row),
        evidence: {
          group: describeElement(parent),
          expectedPadding: expected,
          actualPadding: measurement.values,
          groupSize: measurements.length,
          dominantMembers,
          explicitPaddingTarget: explicitTarget,
        },
        ...(explicitTarget
          ? {
              suggestedCss: {
                "padding-top": cssPixel(expected[0]),
                "padding-right": cssPixel(expected[1]),
                "padding-bottom": cssPixel(expected[2]),
                "padding-left": cssPixel(expected[3]),
              },
            }
          : {}),
      };
      result.push({
        issue,
        root,
        target: measurement.row,
        verify: () => {
          const actual = measurePadding(measurement.row)?.values;
          const errors = expected.map((value, index) =>
            actual === undefined
              ? Number.POSITIVE_INFINITY
              : Math.abs(value - actual[index]!),
          );
          const ok = errors.every((error) => error <= 0.5);
          return {
            ok,
            reason: ok
              ? "row padding joined the dominant group"
              : "row padding remains inconsistent",
            evidence: {
              expectedPadding: expected,
              actualPadding: actual ?? "unavailable",
              errors,
            },
          };
        },
      });
    }
  }
  return result;
}
