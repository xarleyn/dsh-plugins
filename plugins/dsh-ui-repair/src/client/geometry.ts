export interface GeometrySnapshot {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly scrollWidth: number;
  readonly scrollHeight: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
}

export function snapshotGeometry(element: HTMLElement): GeometrySnapshot {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    scrollWidth: element.scrollWidth,
    scrollHeight: element.scrollHeight,
    clientWidth: element.clientWidth,
    clientHeight: element.clientHeight,
  };
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.25;
}

function sameGeometry(
  left: GeometrySnapshot,
  right: GeometrySnapshot,
): boolean {
  return (
    approximatelyEqual(left.x, right.x) &&
    approximatelyEqual(left.y, right.y) &&
    approximatelyEqual(left.width, right.width) &&
    approximatelyEqual(left.height, right.height) &&
    left.scrollWidth === right.scrollWidth &&
    left.scrollHeight === right.scrollHeight &&
    left.clientWidth === right.clientWidth &&
    left.clientHeight === right.clientHeight
  );
}

function nextFrame(document: Document): Promise<void> {
  const schedule = document.defaultView?.requestAnimationFrame;
  if (schedule === undefined) return Promise.resolve();
  return new Promise((resolve) => schedule.call(document.defaultView, () => resolve()));
}

export async function waitForStableLayout(
  element: HTMLElement,
  maxFrames = 4,
): Promise<boolean> {
  let previous = snapshotGeometry(element);
  for (let frame = 0; frame < maxFrames; frame += 1) {
    await nextFrame(element.ownerDocument);
    const current = snapshotGeometry(element);
    if (sameGeometry(previous, current)) return true;
    previous = current;
  }
  return false;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted[middle];
  if (value === undefined) return 0;
  if (sorted.length % 2 === 1) return value;
  return ((sorted[middle - 1] ?? value) + value) / 2;
}

export function dominantPosition(
  values: readonly number[],
  tolerance: number,
): { center: number; members: number } {
  let best: readonly number[] = [];
  for (const value of values) {
    const cluster = values.filter((candidate) =>
      Math.abs(candidate - value) <= tolerance,
    );
    if (cluster.length > best.length) best = cluster;
  }
  return { center: median(best), members: best.length };
}
