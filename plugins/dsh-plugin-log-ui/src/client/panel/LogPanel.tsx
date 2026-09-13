/**
 * The live log panel: the right Sidebar's `plugin-log` tab.
 *
 * It polls the host's ring buffer from a cursor and draws what arrived, so the
 * view is a plain read of a sequence rather than a stream the browser would
 * have to hold open. Three consequences shape the component:
 *
 * - **The window is bounded.** The panel keeps the last
 *   {@link LOG_PANEL_CAPACITY} records and says so when the host buffer evicted
 *   records it never read, so nothing disappears without a line about it.
 * - **Filters are local.** Levels and text narrow what is already in the window,
 *   which is what makes them instant; they are not a query the host answers.
 * - **Polling follows the tab.** A docked body that nobody is looking at (the
 *   column collapsed, another tab selected) asks for nothing, and the user can
 *   pause the stream outright.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { PluginLogRecordLevel, PluginLogRecordView } from "../../types.js";
import {
  ALL_SOURCES,
  LOG_PANEL_CAPACITY,
  LOG_PANEL_LEVELS,
  LOG_PANEL_POLL_MS,
  LOG_PANEL_READ_LIMIT,
  appendRecords,
  filterRecords,
  formatScope,
  formatTime,
  mergeSources,
  type ReadLogTail,
} from "./log-view.js";

/** The panel's injected face: how it asks the host for the next batch, and who writes. */
export interface LogPanelInjected {
  readonly read: ReadLogTail;
  /** Plugin ids the host reports as registered consumers, for the source filter. */
  readonly sources: () => Promise<readonly string[]>;
}

/** The panel's composed props: the tab it draws and its read face. */
export type LogPanelProps = PropsRuntime<"sidebar.right.pane.tab"> & LogPanelInjected;

/** Distance from the bottom still counted as "at the bottom", in px. */
const STICKY_THRESHOLD = 24;

/** The event and its fields, as one run of text after the scope. */
function messageOf(record: PluginLogRecordView): string {
  const fields = record.fields.map((field) => `${field.key}=${field.value}`).join(" ");
  return fields === "" ? record.event : `${record.event} ${fields}`;
}

/** The panel's body. */
export function LogPanel({ read, sources, useTabInfo }: LogPanelProps): ReactNode {
  const { tab } = useTabInfo();
  const [records, setRecords] = useState<readonly PluginLogRecordView[]>([]);
  const [levels, setLevels] = useState<ReadonlySet<PluginLogRecordLevel>>(
    () => new Set(LOG_PANEL_LEVELS),
  );
  const [query, setQuery] = useState("");
  const [source, setSource] = useState(ALL_SOURCES);
  const [registered, setRegistered] = useState<readonly string[]>([]);
  const [paused, setPaused] = useState(false);
  const [follow, setFollow] = useState(true);
  const [dropped, setDropped] = useState(0);
  const [hostBuffered, setHostBuffered] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // The cursor lives in a ref, not in state: the poller is an interval closure
  // and must resume from the last read without being rebuilt on every batch.
  const cursor = useRef(0);
  const reading = useRef(false);
  const body = useRef<HTMLDivElement>(null);

  const poll = useCallback(async () => {
    if (reading.current) return;
    reading.current = true;
    try {
      const result = await read(cursor.current, LOG_PANEL_READ_LIMIT);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      const { value } = result;
      cursor.current = value.cursor;
      setHostBuffered(value.buffered);
      // Accumulated rather than replaced: the host reports what it evicted since
      // the cursor it was asked about, and the reader wants the running total.
      if (value.dropped > 0) setDropped((current) => current + value.dropped);
      setError(null);
      setRecords((current) => appendRecords(current, value.records, LOG_PANEL_CAPACITY));
    } finally {
      reading.current = false;
    }
  }, [read]);

  useEffect(() => {
    // `visible` is the seam the sidebar publishes for exactly this: false while
    // the column is collapsed or another tab holds the pane.
    if (!tab.visible || paused) return undefined;
    void poll();
    const timer = setInterval(() => { void poll(); }, LOG_PANEL_POLL_MS);
    return () => { clearInterval(timer); };
  }, [poll, paused, tab.visible]);

  // The registered consumers are asked for once per visible stint, not per poll:
  // the list changes when a plugin loads or unloads, which is not a per-second
  // event, and a quiet plugin still belongs in the source list.
  useEffect(() => {
    if (!tab.visible) return undefined;
    let cancelled = false;
    void sources()
      .then((ids) => {
        if (!cancelled) setRegistered(ids);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [sources, tab.visible]);

  const filter = useMemo(() => ({ levels, query, source }), [levels, query, source]);
  const visible = useMemo(() => filterRecords(records, filter), [filter, records]);
  const sourceOptions = useMemo(
    () => mergeSources(records, registered, source),
    [records, registered, source],
  );

  useEffect(() => {
    const element = body.current;
    if (element === null || !follow) return;
    element.scrollTop = element.scrollHeight;
  }, [follow, visible]);

  const toggleLevel = useCallback((level: PluginLogRecordLevel) => {
    setLevels((current) => {
      const next = new Set(current);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    // The cursor is kept: clearing the window hides what was read, and the next
    // poll picks up from where the reader actually was.
    setRecords([]);
    setDropped(0);
  }, []);

  return (
    <div className="plu-log" data-plu-log-tab={tab.id}>
      <div className="plu-log-bar">
        <div className="plu-log-levels" role="group" aria-label="Log levels">
          {LOG_PANEL_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              className="plu-log-chip"
              data-plu-level={level}
              data-plu-level-on={levels.has(level) || undefined}
              aria-pressed={levels.has(level)}
              onClick={() => { toggleLevel(level); }}
            >
              {level}
            </button>
          ))}
        </div>
        <div className="plu-log-actions">
          <button
            type="button"
            className="plu-log-action"
            aria-pressed={paused}
            title={paused ? "Resume live output" : "Pause live output"}
            onClick={() => { setPaused((current) => !current); }}
          >
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            type="button"
            className="plu-log-action"
            aria-pressed={follow}
            title="Keep the newest line in view"
            onClick={() => { setFollow(true); }}
          >
            Follow
          </button>
          <button type="button" className="plu-log-action" onClick={clear}>
            Clear
          </button>
        </div>
      </div>

      <div className="plu-log-filters">
        <select
          className="plu-log-source"
          value={source}
          aria-label="Filter by source plugin"
          title="Show one plugin's lines"
          onChange={(event) => { setSource(event.currentTarget.value); }}
        >
          <option value={ALL_SOURCES}>All sources</option>
          {sourceOptions.map((pluginId) => (
            <option value={pluginId} key={pluginId}>{pluginId}</option>
          ))}
        </select>
        <input
          className="plu-log-search"
          type="search"
          value={query}
          placeholder="Filter text"
          aria-label="Filter log text"
          onChange={(event) => { setQuery(event.currentTarget.value); }}
        />
        <span className="plu-log-count">
          {visible.length === records.length
            ? `${records.length} line${records.length === 1 ? "" : "s"}`
            : `${visible.length} of ${records.length} lines`}
          {paused ? " · paused" : ""}
        </span>
      </div>

      {error !== null ? <p className="plu-log-note" role="status">{error}</p> : null}
      {dropped > 0 ? (
        <p className="plu-log-note plu-log-note--drop" role="status">
          {dropped} record{dropped === 1 ? "" : "s"} dropped before this panel could read them.
        </p>
      ) : null}
      {hostBuffered >= LOG_PANEL_CAPACITY && records.length === LOG_PANEL_CAPACITY ? (
        <p className="plu-log-note">Showing the newest {LOG_PANEL_CAPACITY} lines.</p>
      ) : null}

      <div
        className="plu-log-body"
        ref={body}
        role="log"
        aria-live="off"
        onScroll={() => {
          const element = body.current;
          if (element === null) return;
          const atBottom =
            element.scrollHeight - element.scrollTop - element.clientHeight <= STICKY_THRESHOLD;
          setFollow(atBottom);
        }}
      >
        {visible.length === 0 ? (
          <p className="plu-log-empty">
            {records.length === 0
              ? "Nothing logged yet. Records appear here as the host plugins write them."
              : "No line matches the current filters."}
          </p>
        ) : (
          visible.map((record) => (
            <div className="plu-log-line" key={record.seq} data-plu-level={record.level}>
              <span className="plu-log-time">{formatTime(record.time)}</span>{" "}
              <span className="plu-log-level" data-plu-level={record.level}>
                {record.level.toUpperCase()}
              </span>{" "}
              <span className="plu-log-scope">[{formatScope(record)}]</span>{" "}
              <span className="plu-log-message">{messageOf(record)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
