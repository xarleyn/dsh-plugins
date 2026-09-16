import { useEffect, useMemo, useRef, useState } from "react";
import type {
  QaSource,
  QaSourceFilePreview,
  QaTurnSources,
  ResolvedQaSurfaceConfig,
} from "../../types.js";
import type { QaBoundSourceApi } from "../types.js";
import { sourcePreviewFailureCopy } from "../source-preview.js";
import { Markdown } from "./Markdown.js";
import { KIND_LABELS, SourceIcon } from "./source-icon.js";

// Re-exported so the panel stays the icon's historical import site.
export { SourceIcon } from "./source-icon.js";

function sourceTarget(source: QaSource): string {
  return source.path ?? source.uri ?? source.title;
}

function OriginBadges({
  source,
  showOrigin,
}: {
  readonly source: QaSource;
  readonly showOrigin: boolean;
}) {
  const delegated =
    showOrigin && source.origins.some((origin) => origin.role === "subagent");
  const truncated = source.metadata?.truncated === true;
  if (!delegated && !truncated && source.evidence !== "discovered") return null;
  return (
    <span className="dsh-qa-sources__badges">
      {delegated ? <span>Subagent</span> : null}
      {truncated ? <span>Partial</span> : null}
      {source.evidence === "discovered" ? <span>Discovered</span> : null}
    </span>
  );
}

function QaSourceCard({
  source,
  showOriginBadges,
  onOpen,
}: {
  readonly source: QaSource;
  readonly showOriginBadges: boolean;
  readonly onOpen: () => void;
}) {
  return (
    <button type="button" className="dsh-qa-sources__item" onClick={onOpen}>
      <span className="dsh-qa-sources__kind" data-kind={source.kind}>
        <SourceIcon kind={source.kind} />
      </span>
      <span className="dsh-qa-sources__text">
        <span className="dsh-qa-sources__title">{source.title}</span>
        <span className="dsh-qa-sources__target">{sourceTarget(source)}</span>
        <OriginBadges source={source} showOrigin={showOriginBadges} />
        {source.snippet === undefined ? null : <p>{source.snippet}</p>}
      </span>
    </button>
  );
}

function RawFilePreview({
  preview,
  lineStart,
  lineEnd,
}: {
  readonly preview: QaSourceFilePreview;
  readonly lineStart?: number;
  readonly lineEnd?: number;
}) {
  const target = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (typeof target.current?.scrollIntoView === "function") {
      target.current.scrollIntoView({ block: "center" });
    }
  }, [preview.path, lineStart]);
  const lines = preview.content.replace(/\r\n?/gu, "\n").split("\n");
  return (
    <pre className="dsh-qa-preview__raw">
      <code>
        {lines.map((line, index) => {
          const number = index + 1;
          const highlighted =
            lineStart !== undefined &&
            number >= lineStart &&
            number <= (lineEnd ?? lineStart);
          return (
            <span
              key={number}
              ref={number === lineStart ? target : undefined}
              className={
                highlighted
                  ? "dsh-qa-preview__line dsh-qa-preview__line--highlight"
                  : "dsh-qa-preview__line"
              }
            >
              <span className="dsh-qa-preview__number">{number}</span>
              <span>{line || " "}</span>
            </span>
          );
        })}
      </code>
    </pre>
  );
}

function QaSourceDetail({
  source,
  sessionId,
  sourceApi,
  filePreviewConfig,
  showOriginBadges,
  onBack,
}: {
  readonly source: QaSource;
  readonly sessionId: string | null;
  readonly sourceApi: QaBoundSourceApi;
  readonly filePreviewConfig: ResolvedQaSurfaceConfig["sources"]["filePreview"];
  readonly showOriginBadges: boolean;
  readonly onBack: () => void;
}) {
  const [preview, setPreview] = useState<QaSourceFilePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [mode, setMode] = useState<"rendered" | "raw">("raw");
  const external =
    source.uri?.match(/^https?:\/\//iu)?.[0] === undefined
      ? undefined
      : source.uri;
  const firstRange = source.locations.find(
    (location) =>
      location.lineStart !== undefined || location.lineEnd !== undefined,
  );
  const lineStart = firstRange?.lineStart ?? firstRange?.lineEnd;
  const lineEnd = firstRange?.lineEnd ?? firstRange?.lineStart;

  useEffect(() => {
    let alive = true;
    setPreview(null);
    setPreviewError(null);
    if (
      source.path === undefined ||
      sessionId === null ||
      !filePreviewConfig.enabled
    )
      return;
    sourceApi.readSourceFile(sessionId, source.path).then(
      (result) => {
        if (!alive) return;
        if (!result.ok) {
          setPreviewError(sourcePreviewFailureCopy(result.error));
          return;
        }
        setPreview(result.value);
        setMode(
          result.value.markdown &&
            result.value.renderableMarkdown &&
            filePreviewConfig.markdownRenderedByDefault
            ? "rendered"
            : "raw",
        );
      },
      (failure: unknown) =>
        alive && setPreviewError(sourcePreviewFailureCopy(failure)),
    );
    return () => {
      alive = false;
    };
  }, [
    filePreviewConfig.enabled,
    filePreviewConfig.markdownRenderedByDefault,
    sessionId,
    source.id,
    source.path,
    sourceApi,
  ]);

  return (
    <div className="dsh-qa-sourcedetail">
      <div className="dsh-qa-sourcedetail__head">
        <button
          type="button"
          className="dsh-qa-sourcedetail__back"
          aria-label="Ко всем источникам"
          title="Ко всем источникам"
          onClick={onBack}
        >
          <svg viewBox="0 0 14 14" aria-hidden="true">
            <path d="m8.75 3.5-3.5 3.5 3.5 3.5" />
          </svg>
        </button>
        <span className="dsh-qa-sourcedetail__kind">
          <SourceIcon kind={source.kind} />
        </span>
        <span className="dsh-qa-sourcedetail__title">{source.title}</span>
        {preview?.markdown && filePreviewConfig.allowRawToggle ? (
          <span className="dsh-qa-preview__toggle">
            <button
              type="button"
              aria-pressed={mode === "rendered"}
              disabled={!preview.renderableMarkdown}
              onClick={() => setMode("rendered")}
            >
              Rendered
            </button>
            <button
              type="button"
              aria-pressed={mode === "raw"}
              onClick={() => setMode("raw")}
            >
              Raw
            </button>
          </span>
        ) : external === undefined ? null : (
          <a
            className="dsh-qa-sourcedetail__open"
            href={external}
            target="_blank"
            rel="noopener noreferrer"
          >
            Открыть
          </a>
        )}
      </div>
      <div className="dsh-qa-sourcedetail__target">{sourceTarget(source)}</div>
      <div className="dsh-qa-sourcedetail__body">
        <OriginBadges source={source} showOrigin={showOriginBadges} />
        {source.path !== undefined && preview === null && !previewError ? (
          <p className="dsh-qa-sourcedetail__empty">Открываю источник…</p>
        ) : null}
        {previewError !== null ? (
          <p className="dsh-qa-sourcedetail__empty">{previewError}</p>
        ) : null}
        {preview !== null ? (
          <>
            {preview.truncated ? (
              <p className="dsh-qa-preview__notice">
                Показано начало файла: размер превышает лимит preview.
              </p>
            ) : null}
            {lineStart === undefined ? null : (
              <p className="dsh-qa-preview__range">
                Referenced lines: {lineStart}
                {lineEnd !== undefined && lineEnd !== lineStart
                  ? `–${lineEnd}`
                  : ""}
                {mode === "rendered" ? (
                  <button type="button" onClick={() => setMode("raw")}>
                    View raw
                  </button>
                ) : null}
              </p>
            )}
            {mode === "rendered" && preview.renderableMarkdown ? (
              <div className="dsh-qa-preview__markdown">
                <Markdown text={preview.content} />
              </div>
            ) : (
              <RawFilePreview
                preview={preview}
                lineStart={lineStart}
                lineEnd={lineEnd}
              />
            )}
          </>
        ) : source.path === undefined ? (
          source.snippet === undefined ? (
            <p className="dsh-qa-sourcedetail__empty">
              У источника нет текстового фрагмента.
            </p>
          ) : (
            <p>{source.snippet}</p>
          )
        ) : null}
        <p className="dsh-qa-sourcedetail__provenance">
          <span>Использован {source.origins.length} раз(а)</span>
          <span>{source.evidence}</span>
        </p>
      </div>
    </div>
  );
}

export interface QaSourcesPanelProps {
  readonly sources: readonly QaSource[];
  readonly complete: boolean;
  readonly incompleteOrigins?: QaTurnSources["incompleteOrigins"];
  readonly sessionId: string | null;
  readonly sourceApi: QaBoundSourceApi;
  readonly display: ResolvedQaSurfaceConfig["sources"]["display"];
  readonly filePreview: ResolvedQaSurfaceConfig["sources"]["filePreview"];
  /** Open straight onto this source's detail (an inline footnote click). */
  readonly initialDetail?: QaSource | null;
  /** The list is a message-scoped subset rather than the whole chat. */
  readonly pinned?: boolean;
  /** Dismiss the pinned subset and show the whole chat's sources. */
  readonly onShowAll?: () => void;
}

/** Canonical grouped source panel and safe local-file preview. */
export function QaSourcesPanel({
  sources,
  complete,
  incompleteOrigins,
  sessionId,
  sourceApi,
  display,
  filePreview,
  initialDetail = null,
  pinned = false,
  onShowAll,
}: QaSourcesPanelProps) {
  const [detailId, setDetailId] = useState<string | null>(
    initialDetail?.id ?? null,
  );
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const detail =
    detailId === null
      ? undefined
      : (sources.find((source) => source.id === detailId) ??
        (initialDetail?.id === detailId ? initialDetail : undefined));
  const groups = useMemo(() => {
    if (!display.groupByKind)
      return [{ key: "all", label: "Источники", sources }];
    const grouped = new Map<QaSource["kind"], QaSource[]>();
    for (const source of sources)
      grouped.set(source.kind, [...(grouped.get(source.kind) ?? []), source]);
    return [...grouped].map(([key, items]) => ({
      key,
      label: KIND_LABELS[key],
      sources: items,
    }));
  }, [display.groupByKind, sources]);
  return (
    <div className="dsh-qa-sourcespanel">
      {detail === undefined && pinned && onShowAll !== undefined ? (
        <button
          type="button"
          className="dsh-qa-sourcespanel__all"
          onClick={onShowAll}
        >
          Все источники
        </button>
      ) : null}
      {detail === undefined ? (
        <div className="dsh-qa-sources__list">
          {!complete ? (
            <p className="dsh-qa-sources__incomplete">
              Некоторые источники делегированных запусков недоступны (
              {incompleteOrigins?.length ?? 1}).
            </p>
          ) : null}
          {groups.map((group) => {
            const visible = expanded.has(group.key)
              ? group.sources
              : group.sources.slice(0, display.maxInitiallyVisiblePerGroup);
            return (
              <section key={group.key} className="dsh-qa-sources__group">
                <h3>
                  {group.label}
                  <span>{group.sources.length}</span>
                </h3>
                {visible.map((source) => (
                  <QaSourceCard
                    key={source.id}
                    source={source}
                    showOriginBadges={display.showOriginBadges}
                    onOpen={() => setDetailId(source.id)}
                  />
                ))}
                {visible.length < group.sources.length ? (
                  <button
                    type="button"
                    className="dsh-qa-sources__more"
                    onClick={() =>
                      setExpanded(new Set([...expanded, group.key]))
                    }
                  >
                    Показать ещё {group.sources.length - visible.length}
                  </button>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : (
        <QaSourceDetail
          source={detail}
          sessionId={sessionId}
          sourceApi={sourceApi}
          filePreviewConfig={filePreview}
          showOriginBadges={display.showOriginBadges}
          onBack={() => setDetailId(null)}
        />
      )}
    </div>
  );
}
