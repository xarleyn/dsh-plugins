import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

interface FileDropTarget {
  readonly element: RefObject<HTMLElement>;
  readonly fallback?: boolean;
  readonly canDrop: () => boolean;
  readonly onFiles: (files: File[]) => void;
  readonly onActive?: (active: boolean) => void;
}

const targets = new Set<{ current: FileDropTarget }>();

/** Claim file drags before the Host's document listeners can open an overlay. */
function install(window: Window): () => void {
  let depth = 0;
  const reset = () => {
    depth = 0;
    for (const target of targets) target.current.onActive?.(false);
  };
  const handle = (event: DragEvent) => {
    const data = event.dataTransfer;
    if (
      data === null ||
      (!Array.from(data.types).includes("Files") && data.files.length === 0)
    )
      return;
    const zones = Array.from(targets, (target) => target.current).filter(
      (target) => target.element.current?.isConnected,
    );
    // A form's own file field takes precedence over the page-wide composer.
    const path = event.composedPath();
    const target =
      path.flatMap((element) =>
        zones.filter((zone) => zone.element.current === element),
      )[0] ?? zones.find((zone) => zone.fallback);
    if (target === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const accepting = target.canDrop();
    if (event.type === "drop") {
      reset();
      if (accepting) target.onFiles(Array.from(data.files));
      return;
    }
    if (event.type === "dragenter") depth += 1;
    if (event.type === "dragleave") {
      depth = Math.max(0, depth - 1);
      const document = window.document;
      const leftViewport =
        (event.target === document.body ||
          event.target === document.documentElement) &&
        (event.clientX <= 0 ||
          event.clientY <= 0 ||
          event.clientX >= window.innerWidth ||
          event.clientY >= window.innerHeight);
      if (depth === 0 || leftViewport) reset();
      return;
    }
    data.dropEffect = accepting ? "copy" : "none";
    for (const zone of zones) zone.onActive?.(zone === target && accepting);
  };
  const events = ["dragenter", "dragover", "dragleave", "drop"] as const;
  for (const type of events) window.addEventListener(type, handle, true);
  window.addEventListener("dragend", reset);
  window.addEventListener("blur", reset);
  return () => {
    for (const type of events) window.removeEventListener(type, handle, true);
    window.removeEventListener("dragend", reset);
    window.removeEventListener("blur", reset);
  };
}

let uninstall: (() => void) | undefined;

/** Register a QA file receiver; ordinary text and chat drags remain untouched. */
export function useQaFileDrop(target: FileDropTarget): void {
  const latest = useRef(target);
  useLayoutEffect(() => {
    latest.current = target;
  });
  useEffect(() => {
    targets.add(latest);
    uninstall ??= install(window);
    return () => {
      targets.delete(latest);
      if (targets.size === 0) {
        uninstall?.();
        uninstall = undefined;
      }
    };
  }, []);
}
