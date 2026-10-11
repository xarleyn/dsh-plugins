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
  PluginLogTemporaryLevel,
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
/**
 * The one-liner of this plugin's row. Kept equal to `meta.description` in
 * `locale/en.json` — the host reads the row's sentence from there, with the
 * `description` field of `package.json` only behind it as a fallback, so the row
 * reads the same whichever way the sentence reaches the page. Pinned by a test.
 */
const ROW_SUMMARY =
  "DSH settings UI for shared plugin logging levels and file format";
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
/**
 * How long a level the operator does not save may hold. `session` is the last of
 * them because it is the only one with no window to count: the Host keeps it until
 * someone reverts it, and loses it when the Host stops — which is what keeps it
 * out of the Config, where the same choice would outlive both.
 */
const WINDOWS: readonly { readonly value: string; readonly label: string }[] = [
  { value: "5", label: "5 minutes" },
  { value: "15", label: "15 minutes" },
  { value: "30", label: "30 minutes" },
  { value: "60", label: "1 hour" },
  { value: "session", label: "Until revoked" },
];
/** The window and the level a diagnostics look starts on. */
const DEFAULT_WINDOW = "15";
const DEFAULT_TEMPORARY_LEVEL: ManagedPluginLogLevel = "debug";

/**
 * The window of a held level, as the card states it: a countdown for a timed one,
 * the revocation itself for a session one. Recomputed on every poll, so the number
 * the operator reads is the one the Host answered with.
 */
function windowText(level: PluginLogTemporaryLevel): string {
  if (level.remainingMs === undefined) return "until revoked";
  const seconds = Math.ceil(level.remainingMs / 1_000);
  if (seconds < 60) return `${seconds} s left`;
  return `${Math.floor(seconds / 60)} min left`;
}

interface InspectorRemote {
  inspect(): Promise<RemoteResult<PluginLogUiSnapshot>>;
  tail(cursor: number, limit: number): Promise<RemoteResult<PluginLogTail>>;
  setTemporaryLevel(
    pluginId: string,
    level: ManagedPluginLogLevel,
    minutes?: number,
  ): Promise<RemoteResult<PluginLogUiSnapshot>>;
  clearTemporaryLevel(
    pluginId: string,
  ): Promise<RemoteResult<PluginLogUiSnapshot>>;
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
  readonly setTemporaryLevel: InspectorRemote["setTemporaryLevel"];
  readonly clearTemporaryLevel: InspectorRemote["clearTemporaryLevel"];
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

function PluginLogSettingsCard({
  settingsForm,
  inspect,
  setTemporaryLevel,
  clearTemporaryLevel,
}: CardProps) {
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
    temporary: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [holding, setHolding] = useState(false);
  const [holdPlugin, setHoldPlugin] = useState("");
  const [holdLevel, setHoldLevel] = useState<ManagedPluginLogLevel>(
    DEFAULT_TEMPORARY_LEVEL,
  );
  const [holdWindow, setHoldWindow] = useState(DEFAULT_WINDOW);
  const config = settings.value;
  const defaultLevel = config?.defaultLevel ?? "info";
  const format = config?.format ?? "text";
  const levels = config?.levels ?? {};
  const writable = settings.status === "ready" && settings.writable;
  /**
   * What the Host is holding, by plugin id. The saved override a row's select
   * shows and the level the row is actually running at part ways exactly here, so
   * the row can say which of the two the operator is looking at.
   */
  const heldByPlugin = new Map(
    snapshot.temporary.map((level): [string, PluginLogTemporaryLevel] => [
      level.pluginId,
      level,
    ]),
  );

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
    // While the namespace answers `unavailable` the body renders the reason and no
    // registry data, so the poll would be timer work whose result nothing reads.
    if (settings.status === "unavailable") return undefined;
    return startVisibilityAwarePolling(refresh, REFRESH_INTERVAL_MS);
  }, [refresh, settings.status]);

  /**
   * A level the Host holds for a moment. It goes through the plugin's Remote
   * rather than through `settingsForm`, so nothing of it reaches the Config and
   * nothing has to be undone after the look: `set` is never called here, and a
   * test holds that to be true.
   */
  const hold = useCallback(async () => {
    if (holdPlugin === "") return;
    setHolding(true);
    setError(null);
    try {
      const minutes = holdWindow === "session" ? undefined : Number(holdWindow);
      const result = await setTemporaryLevel(holdPlugin, holdLevel, minutes);
      if (result.ok) setSnapshot(result.value);
      else setError(errorText(result.error));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setHolding(false);
    }
  }, [holdLevel, holdPlugin, holdWindow, setTemporaryLevel]);

  const release = useCallback(
    async (pluginId: string) => {
      setHolding(true);
      setError(null);
      try {
        const result = await clearTemporaryLevel(pluginId);
        if (result.ok) setSnapshot(result.value);
        else setError(errorText(result.error));
      } catch (cause) {
        setError(errorText(cause));
      } finally {
        setHolding(false);
      }
    },
    [clearTemporaryLevel],
  );

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

  /*
   * The frame of this surface is the page's, so an unavailable namespace still
   * owes a sentence: rendering nothing would leave the reader inside an opened row
   * with no section and no reason. Only a card that draws its own shell can stay
   * invisible while it has nothing to edit.
   */
  if (settings.status === "unavailable") {
    return (
      <div className="plu-body" data-testid="log-card-section">
        <p className="plu-status" data-testid="log-card-unavailable">
          Plugin logging settings are not reachable over this connection, so
          nothing here can be read or changed yet. The running loggers keep the
          last values the Host accepted.
        </p>
      </div>
    );
  }

  return (
    // The Plugins page draws this card's frame, its heading and its expand
    // control, so the bundle renders the body and nothing around it (AGENTS.md).
    <div className="plu-body" data-testid="log-card-section">
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
          What you pick here is saved to settings and stays until someone
          changes it back; the running loggers take it on the next poll. A
          format switch affects new lines; an existing daily file can contain
          both formats until rotation. To look at a plugin without saving it,
          hold a level for a moment under <strong>Registered plugins</strong>{" "}
          instead.
        </p>
        <p className="plu-hint">
          Live output is the <strong>Plugin logs</strong> tab of the right
          Sidebar: open it there and pick the panel from the guide page.
        </p>
      </section>

      <section className="plu-section">
        <h3>
          Registered plugins
          <span className="plu-count" data-testid="log-card-active-count">
            {snapshot.consumers.length} active
          </span>
        </h3>
        {snapshot.consumers.length === 0 ? (
          <p className="plu-empty" data-testid="log-card-empty">
            No active plugin logger consumers yet.
          </p>
        ) : (
          <>
            <div className="plu-hold" data-testid="log-card-hold-form">
              <p className="plu-hint">
                Hold a level for a moment to look. This is{" "}
                <strong>not a settings write</strong>: nothing is saved, the
                Host keeps the level for the window you pick — or until you
                revert it — and then the plugin goes back to what its settings
                say.
              </p>
              <div className="plu-hold-controls">
                <label className="plu-field">
                  <span>Plugin</span>
                  <select
                    className="plu-select"
                    value={holdPlugin}
                    disabled={!writable || holding}
                    data-testid="log-card-hold-plugin"
                    onChange={(event) =>
                      setHoldPlugin(event.currentTarget.value)
                    }
                  >
                    <option value="">Choose a plugin</option>
                    {snapshot.consumers.map((consumer) => (
                      <option value={consumer.pluginId} key={consumer.pluginId}>
                        {consumer.pluginId}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="plu-field">
                  <span>Level</span>
                  <select
                    className="plu-select"
                    value={holdLevel}
                    disabled={!writable || holding}
                    data-testid="log-card-hold-level"
                    onChange={(event) =>
                      setHoldLevel(
                        event.currentTarget.value as ManagedPluginLogLevel,
                      )
                    }
                  >
                    <LevelOptions />
                  </select>
                </label>
                <label className="plu-field">
                  <span>For</span>
                  <select
                    className="plu-select"
                    value={holdWindow}
                    disabled={!writable || holding}
                    data-testid="log-card-hold-window"
                    onChange={(event) =>
                      setHoldWindow(event.currentTarget.value)
                    }
                  >
                    {WINDOWS.map((option) => (
                      <option value={option.value} key={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="plu-button"
                  disabled={!writable || holding || holdPlugin === ""}
                  data-testid="log-card-hold-apply"
                  onClick={() => void hold()}
                >
                  Hold level
                </button>
              </div>
              {snapshot.temporary.length === 0 ? null : (
                <div className="plu-hold-list" data-testid="log-card-hold-list">
                  {snapshot.temporary.map((held) => (
                    <div
                      className="plu-hold-row"
                      key={held.pluginId}
                      data-testid="log-card-hold-row"
                    >
                      <code>{held.pluginId}</code>
                      <span className="plu-hold-state">
                        held at {held.level} · {windowText(held)} · not saved
                      </span>
                      <button
                        type="button"
                        className="plu-button"
                        disabled={!writable || holding}
                        aria-label={`Revert the held level of ${held.pluginId} now`}
                        data-testid="log-card-hold-revert"
                        onClick={() => void release(held.pluginId)}
                      >
                        Revert now
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="plu-list">
              {snapshot.consumers.map((consumer) => {
                const heldLevel = heldByPlugin.get(consumer.pluginId);
                return (
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
                      {heldLevel === undefined ? null : (
                        <span
                          className="plu-tag"
                          data-testid="log-card-hold-marker"
                        >
                          not saved: held at {heldLevel.level} ·{" "}
                          {windowText(heldLevel)}
                        </span>
                      )}
                    </div>
                    <select
                      className="plu-select"
                      aria-label={`Saved log level for ${consumer.pluginId}`}
                      value={levels[consumer.pluginId] ?? ""}
                      disabled={!writable || saving}
                      data-testid="log-card-plugin-level"
                      onChange={(event) =>
                        setOverride(
                          consumer.pluginId,
                          event.currentTarget.value,
                        )
                      }
                    >
                      <LevelOptions inherit={defaultLevel} />
                    </select>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export const inject = ["slots", "configForms", "remote", "sidebarRightTabs"];

/**
 * The entry the Plugins page renders for this bundle's row.
 *
 * The page owns the chrome on this surface: it draws the card surface, the row
 * title, the row id and the description line, and only then mounts this entry under
 * the section it calls configuration. So the bundle returns the settings body and
 * nothing around it — the shell this card used to draw, with its own header, badge
 * and chevron, would put a second frame and a second heading inside the Host's one.
 * That is decision D1 of §10 of `docs/DSH-0.1.7-MIGRATION.md`, reversed to "as the
 * host does" on 01.10 and landed through #684.
 *
 * The page calls this one entry in two views, and both call sites are the host's:
 * `RowDetail` writes the row's description into a `<p>` and asks this seat for the
 * sentence under `{ view: 'summary' }` when the row declares none, and renders the
 * configuration section under `{ view: 'page', form }`. The contract agrees: `view`
 * carries exactly those two values, and the row seat's own docblock promises the
 * missing-description fallback. `tests/host-seat-contract.test.ts` reads both sites
 * out of the installed `@deepseek-ai/dsh-client-ui-plugin-manager` package rather
 * than restating them here, so a host that stops asking for the summary fails the
 * suite instead of leaving this branch dead. The summary lands inside the page's
 * `<p>`, so it returns the sentence as text and never the body.
 *
 * For this bundle that call is a fallback rather than the row's normal line: the
 * site sits behind the row's own description, which the page takes from the
 * installed manifest's `description` field and this package declares — so the `<p>`
 * is filled before the seat would be asked, and `ROW_SUMMARY` is kept equal to that
 * manifest field.
 */
function PluginLogSettingsEntry(props: CardProps) {
  if (props.view === "summary") return ROW_SUMMARY;
  return <PluginLogSettingsCard {...props} />;
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
              // The hold path is the Remote's own: a level that is not saved never
              // goes near `settingsForm`, so the card cannot write it to the Config.
              setTemporaryLevel: (pluginId, level, minutes) =>
                inspector.setTemporaryLevel(pluginId, level, minutes),
              clearTemporaryLevel: (pluginId) =>
                inspector.clearTemporaryLevel(pluginId),
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
