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

interface IconMeasurement {
  readonly row: HTMLElement;
  readonly icon: HTMLElement;
  readonly x: number;
  readonly width: number;
  readonly height: number;
}

function directRows(parent: HTMLElement): readonly HTMLElement[] {
  return Array.from(parent.children).filter((child) =>
    matches(child, ROW_SELECTOR),
  ) as HTMLElement[];
}

function measureRows(parent: HTMLElement): readonly IconMeasurement[] {
  const measurements: IconMeasurement[] = [];
  for (const row of directRows(parent)) {
    const icon = row.querySelector(ICON_SELECTOR) as HTMLElement | null;
    if (icon === null) continue;
    const rect = icon.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    measurements.push({
      row,
      icon,
      x: rect.x,
      width: rect.width,
      height: rect.height,
    });
  }
  return measurements;
}

function sameIconSize(measurements: readonly IconMeasurement[]): boolean {
  const first = measurements[0];
  if (first === undefined) return false;
  return measurements.every(
    (measurement) =>
      Math.abs(measurement.width - first.width) <= 1 &&
      Math.abs(measurement.height - first.height) <= 1,
  );
}

export function scanIconAlignment(
  root: HTMLElement,
  config: UIRepairConfig,
  createId: (ruleId: string, target: HTMLElement) => string,
): readonly RepairCandidate[] {
  const result: RepairCandidate[] = [];
  const plugin = inferPlugin(root);
  for (const parent of collectElements(root, config.maxElementsPerRoot)) {
    const measurements = measureRows(parent);
    if (measurements.length < 3) continue;
    const positions = measurements.map(({ x }) => x);
    const dominant = dominantPosition(
      positions,
      config.alignmentTolerancePx,
    );
    if (dominant.members < 2) continue;
    const outliers = measurements.filter(
      ({ x }) => Math.abs(x - dominant.center) > config.alignmentTolerancePx,
    );
    if (outliers.length === 0 || outliers.length >= measurements.length / 2) {
      continue;
    }
    const consistentSize = sameIconSize(measurements);
    const explicit = parent.hasAttribute("data-dsh-ui-repair-row-group");
    const clusterRatio = dominant.members / measurements.length;
    const confidence = Math.min(
      1,
      Math.round(
        (0.76 + clusterRatio * 0.12 + (consistentSize ? 0.07 : 0) +
          (outliers.length === 1 ? 0.05 : 0) + (explicit ? 0.04 : 0)) *
          100,
      ) / 100,
    );

    for (const measurement of outliers) {
      const delta = Math.round((dominant.center - measurement.x) * 100) / 100;
      const issue: RepairIssue = {
        id: createId("R001", measurement.icon),
        ruleId: "R001",
        kind: "icon-alignment",
        severity: Math.abs(delta) >= 4 ? "medium" : "low",
        confidence,
        ...(plugin === undefined ? {} : { plugin }),
        root: describeElement(root),
        target: describeElement(measurement.icon),
        evidence: {
          group: describeElement(parent),
          expectedX: dominant.center,
          actualX: measurement.x,
          delta,
          groupSize: measurements.length,
          dominantMembers: dominant.members,
          consistentIconSize: consistentSize,
        },
        suggestedCss: { translate: `${delta}px 0` },
      };
      result.push({
        issue,
        root,
        target: measurement.icon,
        verify: () => {
          const actualX = measurement.icon.getBoundingClientRect().x;
          const error = Math.abs(actualX - dominant.center);
          const ok = error <= config.alignmentTolerancePx;
          return {
            ok,
            reason: ok
              ? "icon joined the dominant alignment line"
              : "icon remains outside the alignment tolerance",
            evidence: { expectedX: dominant.center, actualX, error },
          };
        },
      });
    }
  }
  return result;
}
