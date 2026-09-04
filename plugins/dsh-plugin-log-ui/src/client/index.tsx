import type { Context } from "@deepseek-ai/cordis";
import type { SettingsScope } from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";
import type { InjectFace, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { RemoteResult, TypertRemoteContribution } from "@deepseek-ai/dsh-typert-protocol";
import pluginLogUiRemote from "@yadsh/dsh-plugin-log-ui/remote";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type {
  ManagedPluginLogFormat,
  ManagedPluginLogLevel,
  PluginLogUiConfig,
  PluginLogUiSnapshot,
} from "../types.js";
import { styles } from "./styles.js";
import { bindSettingsExternalStore } from "./settings-store.js";

const SETTINGS_NAMESPACE = "plugin-log";
const REFRESH_INTERVAL_MS = 2_000;
const LEVELS: readonly ManagedPluginLogLevel[] = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
  "silent",
];

interface InspectorRemote {
  inspect(): Promise<RemoteResult<PluginLogUiSnapshot>>;
}

interface ClientRemote {
  $mount(contribution: TypertRemoteContribution): Promise<() => Promise<void>>;
  pluginLogUi: InspectorRemote;
}

interface CardFace {
  readonly scope: SettingsScope<PluginLogUiConfig>;
  readonly inspect: InspectorRemote["inspect"];
}

type CardProps = PropsRuntime<"settings.plugin.item"> & InjectFace<CardFace>;

interface VisibilityDocument {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

interface PollingWindow {
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
    visibilityDocument.removeEventListener("visibilitychange", handleVisibilityChange);
  };
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Could not update plugin logging settings.";
}

function LevelOptions({ inherit }: { readonly inherit?: ManagedPluginLogLevel }) {
  return (
    <>
      {inherit !== undefined ? <option value="">Inherit default ({inherit})</option> : null}
      {LEVELS.map((level) => (
        <option value={level} key={level}>{level === "silent" ? "silent (off)" : level}</option>
      ))}
    </>
  );
}

function ChevronDown() {
  return (
    <svg
      className="dsh-plugin-card__chevron"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m3.5 5.25 3.5 3.5 3.5-3.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PluginLogSettingsCard({ scope, inspect }: CardProps) {
  const settingsStore = useMemo(() => bindSettingsExternalStore(scope), [scope]);
  const settings = useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot,
    settingsStore.getSnapshot,
  );
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<PluginLogUiSnapshot>({ consumers: [] });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const config = settings.value;
  const defaultLevel = config?.defaultLevel ?? "info";
  const format = config?.format ?? "text";
  const levels = config?.levels ?? {};
  const writable = settings.status === "ready" && settings.writable;

  const refresh = useCallback(async () => {
    try {
      const result = await inspect();
      if (result.ok) {
        setSnapshot(result.value);
        setError(null);
      } else {
        setError(errorText(result.error));
      }
    } catch (cause) {
      setError(errorText(cause));
    }
  }, [inspect]);

  useEffect(() => {
    return startVisibilityAwarePolling(refresh, REFRESH_INTERVAL_MS);
  }, [refresh]);

  const write = useCallback(async (field: keyof PluginLogUiConfig, value: unknown) => {
    setSaving(true);
    setError(null);
    try {
      await scope.set(field, value);
      await refresh();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSaving(false);
    }
  }, [refresh, scope]);

  const setOverride = useCallback((pluginId: string, level: string) => {
    const next = { ...levels } as Record<string, ManagedPluginLogLevel>;
    if (level === "") delete next[pluginId];
    else next[pluginId] = level as ManagedPluginLogLevel;
    void write("levels", next);
  }, [levels, write]);

  if (settings.status === "unavailable") return null;

  return (
    <li className={`dsh-plugin-card${open ? " dsh-plugin-card--open" : ""}`}>
      <button
        type="button"
        className="dsh-plugin-card__header"
        aria-expanded={open}
        aria-label={`${open ? "Hide" : "Show"} settings: Plugin logging`}
        onClick={() => setOpen(!open)}
      >
        <span className="dsh-plugin-card__head-text">
          <span className="dsh-plugin-card__name">Plugin logging</span>
          <span className="dsh-plugin-card__description">
            Levels and readable file output for registered server plugins.
          </span>
        </span>
        <span className="dsh-plugin-card__badge">{snapshot.consumers.length} active</span>
        <ChevronDown />
      </button>
      {open ? (
        <div className="dsh-plugin-card__body plu-body">
          {error !== null ? <p className="plu-error" role="status">{error}</p> : null}
          {!writable ? <p className="plu-status">Settings are read-only for this connection.</p> : null}

          <section className="plu-section">
            <h3>Defaults</h3>
            <div className="plu-grid">
              <label className="plu-field">
                <span>Default level</span>
                <select
                  className="plu-select"
                  value={defaultLevel}
                  disabled={!writable || saving}
                  onChange={(event) => void write("defaultLevel", event.currentTarget.value)}
                >
                  <LevelOptions />
                </select>
              </label>
              <label className="plu-field">
                <span>File format</span>
                <select
                  className="plu-select"
                  value={format}
                  disabled={!writable || saving}
                  onChange={(event) => void write("format", event.currentTarget.value as ManagedPluginLogFormat)}
                >
                  <option value="text">Text — readable lines</option>
                  <option value="json">JSON — NDJSON records</option>
                </select>
              </label>
            </div>
            <p className="plu-hint">Changes apply live. A format switch affects new lines; an existing daily file can contain both formats until rotation.</p>
          </section>

          <section className="plu-section">
            <h3>Registered plugins</h3>
            {snapshot.consumers.length === 0 ? (
              <p className="plu-empty">No active plugin logger consumers yet.</p>
            ) : (
              <div className="plu-list">
                {snapshot.consumers.map((consumer) => (
                  <div className="plu-row" key={consumer.pluginId}>
                    <div className="plu-plugin">
                      <code>{consumer.pluginId}</code>
                      <span>{consumer.instances} instance{consumer.instances === 1 ? "" : "s"} · active: {consumer.level} · {consumer.format}</span>
                    </div>
                    <select
                      className="plu-select"
                      aria-label={`Log level for ${consumer.pluginId}`}
                      value={levels[consumer.pluginId] ?? ""}
                      disabled={!writable || saving}
                      onChange={(event) => setOverride(consumer.pluginId, event.currentTarget.value)}
                    >
                      <LevelOptions inherit={defaultLevel} />
                    </select>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </li>
  );
}

export const inject = ["slots", "settingsScope", "remote"];

export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const remote = ctx.remote as unknown as ClientRemote;
  const disposeRemote = await remote.$mount(pluginLogUiRemote);
  await ctx.inject(["remote.pluginLogUi"], (remoteCtx) => {
    const mountedRemote = remoteCtx.remote as unknown as ClientRemote;
    const inspector = mountedRemote.pluginLogUi;
    const scope = remoteCtx.settingsScope.bind<PluginLogUiConfig>({
      namespace: SETTINGS_NAMESPACE,
    });
    const style = document.createElement("style");
    style.dataset.plugin = "dsh-plugin-log-ui";
    style.textContent = styles;
    document.head.append(style);

    const disposeSlot = remoteCtx.slots.inject(
      "settings.plugin.item",
      () => remoteCtx.slots.register(
        {
          name: "settings.plugin.item",
          key: SETTINGS_NAMESPACE,
          inject: () => ({ scope, inspect: () => inspector.inspect() }),
        },
        PluginLogSettingsCard,
      ),
    );

    return () => {
      disposeSlot();
      style.remove();
    };
  });

  return disposeRemote;
}
