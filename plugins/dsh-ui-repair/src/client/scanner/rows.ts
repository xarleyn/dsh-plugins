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

interface RowMeasurement {
  readonly row: HTMLElement;
  readonly x: number;
  readonly width: number;
  readonly height: number;
}

function measureRows(parent: HTMLElement): readonly RowMeasurement[] {
  const result: RowMeasurement[] = [];
  for (const child of Array.from(parent.children)) {
    if (!matches(child, ROW_SELECTOR)) continue;
    const row = child as HTMLElement;
    const rect = row.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    result.push({ row, x: rect.x, width: rect.width, height: rect.height });
  }
  return result;
}

function cssPixel(value: number): string {
  return `${Math.round(value * 100) / 100}px`;
}

export function scanRowAlignment(
  root: HTMLElement,
  config: UIRepairConfig,
  createId: (ruleId: string, target: HTMLElement) => string,
): readonly RepairCandidate[] {
  const result: RepairCandidate[] = [];
  const plugin = inferPlugin(root);
  for (const parent of collectElements(root, config.maxElementsPerRoot)) {
    const measurements = measureRows(parent);
    if (measurements.length < 3) continue;
    const explicitGroup = parent.hasAttribute("data-dsh-ui-repair-row-group");

    const dominantX = dominantPosition(
      measurements.map(({ x }) => x),
      config.alignmentTolerancePx,
    );
    const horizontalOutliers = measurements.filter(
      ({ x }) => Math.abs(x - dominantX.center) > config.alignmentTolerancePx,
    );
    if (
      horizontalOutliers.length > 0 &&
      horizontalOutliers.length < measurements.length / 2
    ) {
      const clusterRatio = dominantX.members / measurements.length;
      const confidence = Math.min(
        1,
        Math.round(
          (0.78 +
            clusterRatio * 0.12 +
            (horizontalOutliers.length === 1 ? 0.05 : 0) +
            (explicitGroup ? 0.04 : 0)) *
            100,
        ) / 100,
      );
      for (const measurement of horizontalOutliers) {
        const delta = Math.round((dominantX.center - measurement.x) * 100) / 100;
        const issue: RepairIssue = {
          id: createId("R003", measurement.row),
          ruleId: "R003",
          kind: "row-horizontal-alignment",
          severity: Math.abs(delta) >= 4 ? "medium" : "low",
          confidence,
          ...(plugin === undefined ? {} : { plugin }),
          root: describeElement(root),
          target: describeElement(measurement.row),
          evidence: {
            group: describeElement(parent),
            expectedX: dominantX.center,
            actualX: measurement.x,
            delta,
            groupSize: measurements.length,
            dominantMembers: dominantX.members,
          },
          suggestedCss: { translate: `${delta}px 0` },
        };
        result.push({
          issue,
          root,
          target: measurement.row,
          verify: () => {
            const actualX = measurement.row.getBoundingClientRect().x;
            const error = Math.abs(actualX - dominantX.center);
            const ok = error <= config.alignmentTolerancePx;
            return {
              ok,
              reason: ok
                ? "row joined the dominant horizontal alignment line"
                : "row remains horizontally misaligned",
              evidence: { expectedX: dominantX.center, actualX, error },
            };
          },
        });
      }
    }

    const dominantHeight = dominantPosition(
      measurements.map(({ height }) => height),
      1,
    );
    const verticalOutliers = measurements.filter(
      ({ height }) => Math.abs(height - dominantHeight.center) > 1,
    );
    if (
      verticalOutliers.length === 0 ||
      verticalOutliers.length >= measurements.length / 2
    ) {
      continue;
    }
    const clusterRatio = dominantHeight.members / measurements.length;
    for (const measurement of verticalOutliers) {
      const explicitTarget = measurement.row.hasAttribute(
        "data-dsh-ui-repair-row-height",
      );
      const confidence = Math.min(
        1,
        Math.round(
          (0.77 +
            clusterRatio * 0.12 +
            (verticalOutliers.length === 1 ? 0.04 : 0) +
            (explicitGroup ? 0.03 : 0) +
            (explicitTarget ? 0.04 : 0)) *
            100,
        ) / 100,
      );
      const issue: RepairIssue = {
        id: createId("R004", measurement.row),
        ruleId: "R004",
        kind: "row-vertical-alignment",
        severity:
          Math.abs(measurement.height - dominantHeight.center) >= 6
            ? "medium"
            : "low",
        confidence,
        ...(plugin === undefined ? {} : { plugin }),
        root: describeElement(root),
        target: describeElement(measurement.row),
        evidence: {
          group: describeElement(parent),
          expectedHeight: dominantHeight.center,
          actualHeight: measurement.height,
          groupSize: measurements.length,
          dominantMembers: dominantHeight.members,
          explicitHeightTarget: explicitTarget,
        },
        ...(explicitTarget
          ? { suggestedCss: { height: cssPixel(dominantHeight.center) } }
          : {}),
      };
      result.push({
        issue,
        root,
        target: measurement.row,
        verify: () => {
          const actualHeight = measurement.row.getBoundingClientRect().height;
          const error = Math.abs(actualHeight - dominantHeight.center);
          const ok = error <= 1;
          return {
            ok,
            reason: ok
              ? "row joined the dominant height group"
              : "row height remains inconsistent",
            evidence: {
              expectedHeight: dominantHeight.center,
              actualHeight,
              error,
            },
          };
        },
      });
    }
  }
  return result;
}
