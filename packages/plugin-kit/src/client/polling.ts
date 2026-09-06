/**
 * Visibility-aware polling for client cards that surface live remote data:
 * refresh once on start, then on every interval tick and every
 * `visibilitychange` — but only while the document is visible. Returns a
 * disposer clearing the timer and the listener.
 */
export interface VisibilityDocument {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export interface PollingWindow {
  setInterval(handler: () => void, timeout: number): number;
  clearInterval(handle: number): void;
}

export function startVisibilityAwarePolling(
  refresh: () => unknown,
  intervalMs: number,
  visibilityDocument: VisibilityDocument = document,
  pollingWindow: PollingWindow = window,
): () => void {
  const refreshWhenVisible = () => {
    if (!visibilityDocument.hidden) void refresh();
  };
  const handleVisibilityChange = () => {
    refreshWhenVisible();
  };

  refreshWhenVisible();
  const timer = pollingWindow.setInterval(refreshWhenVisible, intervalMs);
  visibilityDocument.addEventListener("visibilitychange", handleVisibilityChange);

  return () => {
    pollingWindow.clearInterval(timer);
    visibilityDocument.removeEventListener(
      "visibilitychange",
      handleVisibilityChange,
    );
  };
}
