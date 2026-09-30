import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-api-gateway/client";
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type { ConfigForm } from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
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
/**
 * The seat this card takes on the host Plugins page: the `plugins.row.config`
 * key is the bundle's package name joined to the row id its `cordis.patch.yml`
 * declares, and that row id is the same `dsh-plugin-log-ui` the Config lives
 * under, so the namespace a live stand already wrote is read back unchanged.
 */
const ROW_CONFIG_KEY = `@yadsh/dsh-plugin-log-ui#${SETTINGS_ENTRY_ID}`;
/** The one-liner the page shows for this row in its `summary` view. */
const ROW_SUMMARY =
  "Levels and readable file output for registered server plugins.";
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
  /**
   * The live Config of this plugin's namespace.
   *
   * Named `settingsForm`, not `form`: the row seat already hands its registrant
   * a `form` — the Host's `ConfigPageForm`, which is only `{ state, mutate }` and
   * so can neither be subscribed to nor written field by field. This plugin's own
   * `ConfigForm` arrives through the injected face instead, where the slot's owner
   * prop cannot collide with it.
   */
  readonly settingsForm: ConfigForm<PluginLogUiConfig>;
  readonly inspect: InspectorRemote["inspect"];
}

type CardProps = PropsRuntime<"plugins.row.config"> & InjectFace<CardFace>;

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

function PluginLogSettingsCard({ settingsForm, inspect }: CardProps) {
  const settingsStore = useMemo(
    () => bindSettingsExternalStore(settingsForm),
    [settingsForm],
  );
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
        if (!(await settingsForm.set(field, value))) {
          throw new TypeError("The Host refused the settings write.");
        }
        await refresh();
      } catch (cause) {
        setError(errorText(cause));
      } finally {
        setSaving(false);
      }
    },
    [refresh, settingsForm],
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
      description={ROW_SUMMARY}
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
 * The entry the Plugins page renders for this bundle's row.
 *
 * The shell's root is an `<li>`, and the page's configuration section supplies no
 * list of its own, so the card is mounted inside a plugin-owned `<ul>` — AGENTS.md
 * keeps the `ul > li` pair that the shell's own styling is written against.
 *
 * The page renders this one entry in two views, and both call sites are the
 * host's own: `RowDetail` puts the row's description into a `<p>`, falling back to
 * this entry under `{ view: "summary" }` when the row declares none
 * (`@deepseek-ai/dsh-client-ui-plugin-manager@0.1.7-rc.2`, `lib/client.js:1841`),
 * and renders it under `{ view: "page", form }` in the configuration section below
 * (`:1852`). The summary therefore lands inside the page's `<p>`, so it returns the
 * sentence as text and never a second card.
 */
function PluginLogSettingsEntry(props: CardProps) {
  if (props.view === "summary") return ROW_SUMMARY;
  return (
    <ul className="plu-card-list" data-testid="log-card-section">
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
  // Host resolved the volatile schema under. The row seat hands a `ConfigPageForm`
  // for the same namespace, but that view is `{ state, mutate }` only — it cannot
  // be subscribed to and writes no single field — so the card resolves its own.
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
      return remoteCtx.slots.inject("plugins.row.config", () =>
        remoteCtx.slots.register(
          {
            name: "plugins.row.config",
            key: ROW_CONFIG_KEY,
            inject: () => ({
              settingsForm: form,
              inspect: () => inspector.inspect(),
            }),
          },
          PluginLogSettingsEntry,
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
