import type { SettingsScope } from "@deepseek-ai/dsh-client-ui-settings/client";
import { DEFAULT_QA_SURFACE_CONFIG, resolveConfig } from "../resolve-config.js";
import type { QaSurfaceConfig, ResolvedQaSurfaceConfig } from "../types.js";

export interface QaConfigSnapshot {
  readonly status: "loading" | "ready" | "unavailable" | "error";
  readonly config: ResolvedQaSurfaceConfig;
  readonly error: string | null;
}

/** Reads the effective Host configuration when the settings namespace cannot. */
export type QaConfigFallback = () => Promise<ResolvedQaSurfaceConfig>;

/**
 * Browser projection of the Host-owned qa-surface settings namespace.
 *
 * The DSH gateway pins settings RPCs to loopback, so a browser served over the
 * LAN always sees the namespace as `unavailable`. When the caller supplies the
 * `qaSurface/describe` Remote as a fallback, that channel answers instead: the
 * projection waits in `loading` until it settles, then reports the Host-owned
 * configuration as `ready`. A rejected fallback returns the projection to
 * `unavailable`, exactly as when no fallback exists.
 */
export class QaConfigController {
  private readonly listeners = new Set<() => void>();
  private snapshot: QaConfigSnapshot;
  private readonly unsubscribe: () => void;
  private readonly fallback: QaConfigFallback | undefined;
  private fallbackState:
    "idle" | "pending" | "ready" | "refreshing" | "failed" = "idle";
  private fallbackConfig: ResolvedQaSurfaceConfig | undefined;
  private disposed = false;

  constructor(
    private readonly scope: SettingsScope<QaSurfaceConfig>,
    fallback?: QaConfigFallback,
  ) {
    this.fallback = fallback;
    this.snapshot = this.project();
    this.unsubscribe = scope.subscribe(() => this.refresh());
    this.refresh();
  }

  getSnapshot = (): QaConfigSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.listeners.clear();
  }

  private project(): QaConfigSnapshot {
    const settings = this.scope.getSnapshot();
    if (settings.status === "loading") {
      return {
        status: "loading",
        config: DEFAULT_QA_SURFACE_CONFIG,
        error: null,
      };
    }
    if (settings.status === "unavailable") {
      if (
        (this.fallbackState === "ready" ||
          this.fallbackState === "refreshing") &&
        this.fallbackConfig !== undefined
      ) {
        return {
          status: "ready",
          config: this.fallbackConfig,
          error: null,
        };
      }
      if (this.fallbackState === "pending") {
        return {
          status: "loading",
          config: DEFAULT_QA_SURFACE_CONFIG,
          error: null,
        };
      }
      return {
        status: "unavailable",
        config: DEFAULT_QA_SURFACE_CONFIG,
        error: null,
      };
    }
    try {
      return {
        status: "ready",
        config: resolveConfig(settings.value ?? {}),
        error: null,
      };
    } catch {
      return {
        status: "error",
        config: DEFAULT_QA_SURFACE_CONFIG,
        error: "Настройки помощника недоступны.",
      };
    }
  }

  private refresh(): void {
    this.requestFallbackIfNeeded();
    const projected = this.project();
    const next: QaConfigSnapshot =
      JSON.stringify(projected.config) === JSON.stringify(this.snapshot.config)
        ? { ...projected, config: this.snapshot.config }
        : projected;
    if (
      next.status === this.snapshot.status &&
      next.config === this.snapshot.config &&
      next.error === this.snapshot.error
    ) {
      return;
    }
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }

  /**
   * Re-read the Host configuration after a Host reconnect. Without this, an
   * open page keeps the configuration it fetched at load time: after the Host
   * restarts with a changed deployment config, the next attestation compares
   * its proof against the stale client copy and refuses. While re-reading,
   * the previous answer stays projected — no loading flicker; the snapshot
   * updates only when the answer actually changed.
   */
  refreshFallback(): void {
    if (
      this.disposed ||
      this.fallback === undefined ||
      this.fallbackState === "idle" ||
      this.fallbackState === "pending" ||
      this.scope.getSnapshot().status === "ready"
    ) {
      return;
    }
    this.fallbackState = "refreshing";
    void this.fallback().then(
      (config) => {
        if (this.disposed) return;
        try {
          this.fallbackConfig = resolveConfig(config);
        } catch {
          // A malformed answer must not wipe a working previous one.
        }
        this.fallbackState = "ready";
        // refresh() keeps the old projection when the answer is unchanged.
        this.refresh();
      },
      (error: unknown) => {
        if (this.disposed) return;
        console.warn(
          "dsh-qa-surface: Host configuration refresh failed",
          error,
        );
        this.fallbackState = "ready";
      },
    );
  }

  /**
   * The fallback trigger rides every refresh: the scope flips to
   * `unavailable` whenever the browser is served over the LAN, which a
   * constructor-time check can miss. The state guard makes repeats a no-op,
   * so one fetch runs per controller lifetime; the recursive refresh lets the
   * pending state surface before the first notification pass.
   */
  private requestFallbackIfNeeded(): void {
    if (
      this.disposed ||
      this.fallback === undefined ||
      this.fallbackState !== "idle" ||
      this.scope.getSnapshot().status !== "unavailable"
    ) {
      return;
    }
    this.fallbackState = "pending";
    this.refresh();
    void this.fallback().then(
      (config) => {
        if (this.disposed) return;
        try {
          this.fallbackConfig = resolveConfig(config);
          this.fallbackState = "ready";
        } catch {
          this.fallbackState = "failed";
        }
        this.refresh();
      },
      (error: unknown) => {
        if (this.disposed) return;
        console.warn(
          "dsh-qa-surface: Host configuration is unavailable",
          error,
        );
        this.fallbackState = "failed";
        this.refresh();
      },
    );
  }
}
