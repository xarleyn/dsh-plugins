import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-api-gateway/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type { ConfigForm } from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar-right/client";
import type {
  InjectFace,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import pluginLogUiRemote from "@yadsh/dsh-plugin-log-ui/remote";
import {
  CardShell,
  bindSettingsExternalStore,
  injectCardStyles,
  startVisibilityAwarePolling,
} from "@yadsh/dsh-plugin-kit/client";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  ManagedPluginLogFormat,
  ManagedPluginLogLevel,
  PluginLogTail,
  PluginLogUiConfig,
  PluginLogUiSnapshot,
} from "../types.js";
import { LogPanel } from "./panel/LogPanel.js";
import { logPanelDefinition, LOG_PANEL_ID } from "./panel/definition.js";
import { createLogTailReader } from "./panel/log-view.js";
import { PANEL_STYLES } from "./panel/styles.js";
import { styles } from "./styles.js";

/** The profile entry id the Host files this plugin's live Config under. */
const SETTINGS_ENTRY_ID = "dsh-plugin-log-ui";
/** The seat this card takes on the host Plugins settings page. */
const SETTINGS_TAB_ID = "plugin-log";
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
  tail(cursor: number, limit: number): Promise<RemoteResult<PluginLogTail>>;
}

interface ClientRemote {
  $mount(contribution: TypertRemoteContribution): Promise<() => Promise<void>>;
  pluginLogUi: InspectorRemote;
}

interface CardFace {
  readonly form: ConfigForm<PluginLogUiConfig>;
  readonly inspect: InspectorRemote["inspect"];
}

type CardProps = PropsRuntime<"settings.plugins.tab"> & InjectFace<CardFace>;

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Could not update plugin logging settings.";
}

function LevelOptions({
  inherit,
}: {
  readonly inherit?: ManagedPluginLogLevel;
}) {
  return (
    <>
      {inherit !== undefined ? (
        <option value="">Inherit default ({inherit})</option>
      ) : null}
      {LEVELS.map((level) => (
        <option value={level} key={level}>
          {level === "silent" ? "silent (off)" : level}
        </option>
      ))}
    </>
  );
}

function PluginLogSettingsCard({ form, inspect }: CardProps) {
  const settingsStore = useMemo(() => bindSettingsExternalStore(form), [form]);
  const settings = useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot,
    settingsStore.getSnapshot,
  );
  const [snapshot, setSnapshot] = useState<PluginLogUiSnapshot>({
    consumers: [],
  });
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

  const write = useCallback(
    async (field: keyof PluginLogUiConfig, value: unknown) => {
      setSaving(true);
      setError(null);
      try {
        // `set` settles false when the Host refuses or supersedes the write;
        // only a transport failure rejects, so the refusal needs saying here.
        if (!(await form.set(field, value))) {
          throw new TypeError("The Host refused the settings write.");
        }
        await refresh();
      } catch (cause) {
        setError(errorText(cause));
      } finally {
        setSaving(false);
      }
    },
    [form, refresh],
  );

  const setOverride = useCallback(
    (pluginId: string, level: string) => {
      const next = { ...levels } as Record<string, ManagedPluginLogLevel>;
      if (level === "") delete next[pluginId];
      else next[pluginId] = level as ManagedPluginLogLevel;
      void write("levels", next);
    },
    [levels, write],
  );

  if (settings.status === "unavailable") return null;

  return (
    <CardShell
      title="Plugin logging"
      description="Levels and readable file output for registered server plugins."
      badge={
        <span className="dsh-plugin-card__badge">
          {snapshot.consumers.length} active
        </span>
      }
      label={(open) => `${open ? "Hide" : "Show"} settings: Plugin logging`}
      bodyClassName="plu-body"
    >
      {error !== null ? (
        <p className="plu-error" role="status" data-testid="log-card-error">
          {error}
        </p>
      ) : null}
      {!writable ? (
        <p className="plu-status" data-testid="log-card-read-only">
          Settings are read-only for this connection.
        </p>
      ) : null}

      <section className="plu-section">
        <h3>Defaults</h3>
        <div className="plu-grid">
          <label className="plu-field">
            <span>Default level</span>
            <select
              className="plu-select"
              value={defaultLevel}
              disabled={!writable || saving}
              data-testid="log-card-default-level"
              onChange={(event) =>
                void write("defaultLevel", event.currentTarget.value)
              }
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
              data-testid="log-card-format"
              onChange={(event) =>
                void write(
                  "format",
                  event.currentTarget.value as ManagedPluginLogFormat,
                )
              }
            >
              <option value="text">Text — readable lines</option>
              <option value="json">JSON — NDJSON records</option>
            </select>
          </label>
        </div>
        <p className="plu-hint">
          Changes apply live. A format switch affects new lines; an existing
          daily file can contain both formats until rotation.
        </p>
        <p className="plu-hint">
          Live output is the <strong>Plugin logs</strong> tab of the right
          Sidebar: open it there and pick the panel from the guide page.
        </p>
      </section>

      <section className="plu-section">
        <h3>Registered plugins</h3>
        {snapshot.consumers.length === 0 ? (
          <p className="plu-empty" data-testid="log-card-empty">
            No active plugin logger consumers yet.
          </p>
        ) : (
          <div className="plu-list">
            {snapshot.consumers.map((consumer) => (
              <div
                className="plu-row"
                key={consumer.pluginId}
                data-testid="log-card-plugin-row"
              >
                <div className="plu-plugin">
                  <code>{consumer.pluginId}</code>
                  <span>
                    {consumer.instances} instance
                    {consumer.instances === 1 ? "" : "s"} · active:{" "}
                    {consumer.level} · {consumer.format}
                  </span>
                </div>
                <select
                  className="plu-select"
                  aria-label={`Log level for ${consumer.pluginId}`}
                  value={levels[consumer.pluginId] ?? ""}
                  disabled={!writable || saving}
                  data-testid="log-card-plugin-level"
                  onChange={(event) =>
                    setOverride(consumer.pluginId, event.currentTarget.value)
                  }
                >
                  <LevelOptions inherit={defaultLevel} />
                </select>
              </div>
            ))}
          </div>
        )}
      </section>
    </CardShell>
  );
}

export const inject = ["slots", "configForms", "remote", "sidebarRightTabs"];

/**
 * The seat on the host Plugins page.
 *
 * The shell's root is an `<li>`, and the tab pane supplies no list of its own,
 * so the card is mounted inside a plugin-owned `<ul>` — AGENTS.md keeps the
 * `ul > li` pair that the shell's own styling is written against.
 */
function PluginLogSettingsTab(props: CardProps) {
  return (
    <ul className="plu-tab" data-testid="log-tab">
      <PluginLogSettingsCard {...props} />
    </ul>
  );
}

/**
 * The settings card's stylesheet key.
 *
 * One key owns one `<style>` tag: `injectCardStyles` treats a key it has already
 * seen as "this sheet is injected" and returns a no-op. Two sheets under one key
 * therefore lose the second one silently, styled by nobody.
 */
const CARD_STYLE_KEY = "dsh-plugin-log-ui";

/** The log panel's key: its own tag, for the reason above. */
const PANEL_STYLE_KEY = `${CARD_STYLE_KEY}/panel`;

export async function apply(ctx: Context): Promise<() => Promise<void>> {
  // The panel is a page tab on the host's right Sidebar. Its type registers
  // through the public two-stage path, so the column dispatches the body below
  // by this plugin's own id rather than by anything hard-coded there.
  const removeCardStyles = injectCardStyles(CARD_STYLE_KEY, styles);
  const removePanelStyles = injectCardStyles(PANEL_STYLE_KEY, PANEL_STYLES);
  ctx.effect(
    () => ctx.sidebarRightTabs.register(logPanelDefinition()),
    "dsh-plugin-log-ui: log panel type",
  );

  // The live form of this plugin's Config, keyed by the profile entry id the
  // Host resolved the volatile schema under. `settings.plugins.tab` hands a
  // registrant no form of its own, so the card resolves it here.
  const form = ctx.configForms.get<PluginLogUiConfig>(SETTINGS_ENTRY_ID);

  const remote = ctx.remote as unknown as ClientRemote;
  const disposeRemote = await remote.$mount(pluginLogUiRemote);
  let disposePanel: (() => void) | undefined;
  try {
    await ctx.inject(["remote.pluginLogUi"], (remoteCtx) => {
      const mountedRemote = remoteCtx.remote as unknown as ClientRemote;
      const inspector = mountedRemote.pluginLogUi;
      // The column may not have declared its seat yet when this plugin loads, so
      // the body waits for the declaration instead of assuming boot order. The
      // callback is re-entered if the namespace is withdrawn and re-provided, so
      // each pass replaces the previous registration rather than stacking one.
      disposePanel?.();
      disposePanel = remoteCtx.slots.inject("sidebar.right.pane.tab", () =>
        remoteCtx.slots.register(
          {
            name: "sidebar.right.pane.tab",
            key: LOG_PANEL_ID,
            inject: () => ({
              read: createLogTailReader(inspector),
              // The source filter's list, from the registry rather than from the
              // window: a plugin that has gone quiet is still a source a reader
              // may want to isolate.
              sources: async () => {
                const snapshot = await inspector.inspect();
                if (!snapshot.ok) return [];
                return snapshot.value.consumers.map(
                  (consumer) => consumer.pluginId,
                );
              },
            }),
          },
          LogPanel,
        ),
      );
      return remoteCtx.slots.inject("settings.plugins.tab", () =>
        remoteCtx.slots.register(
          {
            name: "settings.plugins.tab",
            id: SETTINGS_TAB_ID,
            order: 30,
            label: () => "Plugin logging",
            inject: () => ({ form, inspect: () => inspector.inspect() }),
          },
          PluginLogSettingsTab,
        ),
      );
    });
  } catch (error) {
    disposePanel?.();
    removeCardStyles();
    removePanelStyles();
    await disposeRemote();
    throw error;
  }

  return async () => {
    disposePanel?.();
    removeCardStyles();
    removePanelStyles();
    return disposeRemote();
  };
}
