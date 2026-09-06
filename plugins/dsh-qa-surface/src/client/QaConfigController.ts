import type { SettingsScope } from "@deepseek-ai/dsh-client-runtime/client";
import { DEFAULT_QA_SURFACE_CONFIG, resolveConfig } from "../resolve-config.js";
import type { QaSurfaceConfig, ResolvedQaSurfaceConfig } from "../types.js";

export interface QaConfigSnapshot {
  readonly status: "loading" | "ready" | "unavailable" | "error";
  readonly config: ResolvedQaSurfaceConfig;
  readonly error: string | null;
}

/** Browser projection of the Host-owned qa-surface settings namespace. */
export class QaConfigController {
  private readonly listeners = new Set<() => void>();
  private snapshot: QaConfigSnapshot;
  private readonly unsubscribe: () => void;

  constructor(private readonly scope: SettingsScope<QaSurfaceConfig>) {
    this.snapshot = this.project();
    this.unsubscribe = scope.subscribe(() => this.refresh());
  }

  getSnapshot = (): QaConfigSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  dispose(): void {
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
        error: "The assistant configuration is unavailable.",
      };
    }
  }

  private refresh(): void {
    const next = this.project();
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
}
