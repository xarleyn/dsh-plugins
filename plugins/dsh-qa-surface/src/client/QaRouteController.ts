import type { ResolvedQaSurfaceConfig } from "../types.js";
import { QA_NAVIGATION_MARKER } from "../navigation-marker.js";

export interface QaRouteSnapshot {
  readonly pathname: string;
  readonly active: boolean;
}

interface NavigationHistory {
  pushState(data: unknown, unused: string, url?: string | URL | null): void;
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

interface NavigationWindow {
  readonly location: { readonly pathname: string; readonly search?: string };
  readonly history: NavigationHistory;
  addEventListener(type: "popstate", listener: () => void): void;
  removeEventListener(type: "popstate", listener: () => void): void;
}

export function matchesQaRoute(
  pathname: string,
  route: ResolvedQaSurfaceConfig["route"],
): boolean {
  if (pathname === route.path || pathname === `${route.path}/`) return true;
  if (route.path === "/") return route.matchChildren;
  if (!route.matchChildren) return false;
  return pathname.startsWith(`${route.path}/`);
}

/** Observable route matcher with reversible History API instrumentation. */
export class QaRouteController {
  private readonly listeners = new Set<() => void>();
  private route: ResolvedQaSurfaceConfig["route"] = {
    path: "/qa",
    matchChildren: true,
  };
  private enabled = false;
  private snapshot: QaRouteSnapshot;
  private readonly originalPushState: NavigationHistory["pushState"];
  private readonly originalReplaceState: NavigationHistory["replaceState"];
  private readonly wrappedPushState: NavigationHistory["pushState"];
  private readonly wrappedReplaceState: NavigationHistory["replaceState"];
  private disposed = false;

  constructor(private readonly target: NavigationWindow = window) {
    this.originalPushState = target.history.pushState;
    this.originalReplaceState = target.history.replaceState;
    this.restoreRedirectedPath();
    this.snapshot = this.project();
    const refresh = () => this.refresh();
    const history = target.history;
    const originalPushState = this.originalPushState;
    const originalReplaceState = this.originalReplaceState;
    this.wrappedPushState = function (
      ...args: Parameters<NavigationHistory["pushState"]>
    ) {
      Reflect.apply(originalPushState, history, args);
      refresh();
    };
    this.wrappedReplaceState = function (
      ...args: Parameters<NavigationHistory["replaceState"]>
    ) {
      Reflect.apply(originalReplaceState, history, args);
      refresh();
    };
    target.history.pushState = this.wrappedPushState;
    target.history.replaceState = this.wrappedReplaceState;
    target.addEventListener("popstate", refresh);
    this.removePopstate = () => target.removeEventListener("popstate", refresh);
  }

  private readonly removePopstate: () => void;

  getSnapshot = (): QaRouteSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  configure(config: ResolvedQaSurfaceConfig, ready = true): void {
    this.route = config.route;
    this.enabled = ready && config.enabled;
    this.refresh();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.removePopstate();
    if (this.target.history.pushState === this.wrappedPushState) {
      this.target.history.pushState = this.originalPushState;
    }
    if (this.target.history.replaceState === this.wrappedReplaceState) {
      this.target.history.replaceState = this.originalReplaceState;
    }
    this.listeners.clear();
  }

  private project(): QaRouteSnapshot {
    const pathname = this.target.location.pathname;
    return {
      pathname,
      active: this.enabled && matchesQaRoute(pathname, this.route),
    };
  }

  private restoreRedirectedPath(): void {
    const search = this.target.location.search;
    if (search === undefined || search === "") return;
    const requested = new URLSearchParams(search).get(QA_NAVIGATION_MARKER);
    if (
      requested === null ||
      !requested.startsWith("/") ||
      requested.startsWith("//")
    ) {
      return;
    }
    Reflect.apply(this.originalReplaceState, this.target.history, [
      null,
      "",
      requested,
    ]);
  }

  private refresh(): void {
    if (this.disposed) return;
    const next = this.project();
    if (
      next.pathname === this.snapshot.pathname &&
      next.active === this.snapshot.active
    ) {
      return;
    }
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
