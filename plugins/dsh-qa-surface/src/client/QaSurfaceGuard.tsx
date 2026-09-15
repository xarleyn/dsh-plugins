import {
  Component,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type {
  QaRouteController,
  QaRouteSnapshot,
} from "./QaRouteController.js";
import type { QaConfigController } from "./QaConfigController.js";
import { QaSurface, type QaSurfaceProps } from "./QaSurface.js";

/** Fallback route read when the face failed to assemble: keep the page masked. */
const MASKED_ROUTE: QaRouteSnapshot = { pathname: "", active: true };
const noopSubscribe = () => () => undefined;

/**
 * The registered `shell.overlay` entry: the surface behind an error boundary
 * the host never sees past. The host's per-slot isolation retires a crashed
 * entry, which for this slot means the QA overlay disappears and the operator
 * shell beneath it becomes reachable — a render crash must never be allowed
 * to make that trade. The boundary keeps the overlay mounted and swaps the
 * surface for a fullscreen failure card; the reload button is the recovery,
 * because after a render crash the component state below (controllers,
 * stores) is untrustworthy.
 *
 * The body mask (`data-dsh-qa-surface`) is owned here, above the boundary:
 * React unmounts a crashed subtree, and the stylesheet that hides the host
 * frame's own columns hangs off that attribute, so a crash unmounting the
 * surface must not lift the mask with it. Deleting the overlay element in
 * the browser then reveals a blank page, not the shell.
 *
 * The wrapper is a function component only because the slot contract types
 * entries as call signatures; its render is trivial and cannot itself throw
 * into the host boundary. It also covers a face that failed to assemble: the
 * slot inject hands over an empty face in that case, a missing route reads
 * as permanently active, and the surface's first hook read throws into the
 * boundary below.
 */
export function QaSurfaceGuard(props: QaSurfaceProps): ReactNode {
  const route = props.route as QaRouteController | undefined;
  const routeSnapshot = useSyncExternalStore(
    route?.subscribe ?? noopSubscribe,
    route?.getSnapshot ?? (() => MASKED_ROUTE),
    route?.getSnapshot ?? (() => MASKED_ROUTE),
  );
  const active = routeSnapshot.active;

  useEffect(() => {
    if (!active) return;
    // While the surface owns the page, the tab carries the deployment's
    // brand — the same logo the sidebar and the auth gate render. The host's
    // own icon links come back when the route is left (or the plugin
    // unloads): they are removed and restored, not fought over.
    const config = props.config as QaConfigController | undefined;
    const logoUrl = config?.getSnapshot().config.branding.logoUrl ?? null;
    const hostIcons = Array.from(
      document.head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'),
    );
    if (logoUrl !== null) {
      for (const icon of hostIcons) icon.remove();
      const link = document.createElement("link");
      link.rel = "icon";
      link.href = logoUrl;
      link.dataset.dshQaSurface = "favicon";
      document.head.append(link);
    }
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.dataset.dshQaSurface = "active";
    // Lift the proxy-injected boot mask in the same synchronous block: the
    // body attribute above re-masks the host columns and this flag shows the
    // body again, so no paint falls between "hidden boot page" and takeover.
    // The flag is never cleared — off-route, the boot CSS no longer matches.
    document.documentElement.dataset.dshQaBoot = "done";
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.querySelector('link[data-dsh-qa-surface="favicon"]')?.remove();
      for (const icon of hostIcons.reverse()) document.head.prepend(icon);
      delete document.body.dataset.dshQaSurface;
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [active, props.config]);

  // Off-route the host shell is the page again (the mask attribute lifts);
  // unmounting the subtree also gives a crashed surface a fresh boundary on
  // re-entry instead of a permanently stuck failure card.
  if (!active) return null;
  return <QaSurfaceBoundary {...props} />;
}

class QaSurfaceBoundary extends Component<QaSurfaceProps, { error: unknown }> {
  override state: { error: unknown } = { error: undefined };

  static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error };
  }

  override componentDidCatch(error: unknown): void {
    console.error("dsh-qa-surface: surface render failed", error);
  }

  override render(): ReactNode {
    if (this.state.error === undefined) {
      return <QaSurface {...this.props} />;
    }
    return (
      <main className="dsh-qa-surface dsh-qa-crash" role="alert">
        <section className="dsh-qa-crash__card">
          <h1>Интерфейс не смог открыться</h1>
          <p>
            Произошла внутренняя ошибка. Перезагрузите страницу — если ошибка
            повторяется, сообщите администратору стенда.
          </p>
          <button
            type="button"
            className="dsh-qa-crash__reload"
            onClick={() => {
              window.location.reload();
            }}
          >
            Перезагрузить
          </button>
        </section>
      </main>
    );
  }
}
