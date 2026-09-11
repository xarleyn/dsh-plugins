import { useState } from "react";
import type { QaSource } from "../../types.js";

function sourceTarget(source: QaSource): string {
  return source.path ?? source.uri ?? source.title;
}

function SourceIcon({ kind }: { readonly kind: QaSource["kind"] }) {
  if (kind === "web") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="5.75" />
        <path d="M2.25 8h11.5M8 2.25c1.6 1.55 2.4 3.5 2.4 5.75S9.6 12.2 8 13.75C6.4 12.2 5.6 10.25 5.6 8S6.4 3.8 8 2.25Z" />
      </svg>
    );
  }
  if (kind === "jira" || kind === "confluence" || kind === "knowledge") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="7.1" cy="7.1" r="4.3" />
        <path d="m10.3 10.3 2.9 2.9" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M9.25 2.5H4.75A1.25 1.25 0 0 0 3.5 3.75v8.5a1.25 1.25 0 0 0 1.25 1.25h6.5a1.25 1.25 0 0 0 1.25-1.25V5.75L9.25 2.5Z" />
      <path d="M9.25 2.5v3.25h3.25" />
    </svg>
  );
}

function QaSourceCard({
  source,
  onOpen,
}: {
  readonly source: QaSource;
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
        {source.snippet === undefined ? null : <p>{source.snippet}</p>}
      </span>
    </button>
  );
}

function QaSourceDetail({
  source,
  onBack,
}: {
  readonly source: QaSource;
  readonly onBack: () => void;
}) {
  const external =
    source.uri !== undefined && /^https?:\/\//iu.test(source.uri)
      ? source.uri
      : undefined;
  const ranges = source.locations
    .filter(
      (location) =>
        location.lineStart !== undefined || location.lineEnd !== undefined,
    )
    .map((location) =>
      location.lineStart === location.lineEnd
        ? `строка ${location.lineStart}`
        : `строки ${location.lineStart ?? "?"}–${location.lineEnd ?? "?"}`,
    );
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
        {external === undefined ? null : (
          <a
            className="dsh-qa-sourcedetail__open"
            href={external}
            target="_blank"
            rel="noreferrer"
          >
            Открыть
          </a>
        )}
      </div>
      <div className="dsh-qa-sourcedetail__target">{sourceTarget(source)}</div>
      <div className="dsh-qa-sourcedetail__body">
        {source.snippet === undefined ? (
          <p className="dsh-qa-sourcedetail__empty">
            У источника нет текстового фрагмента.
          </p>
        ) : (
          <p>{source.snippet}</p>
        )}
        {ranges.length === 0 ? null : <p>{ranges.join(", ")}</p>}
        <p>
          Использован {source.origins.length} раз(а) · {source.evidence}
        </p>
      </div>
    </div>
  );
}

export interface QaSourcesDrawerProps {
  readonly sources: readonly QaSource[];
  readonly onClose: () => void;
}

/** Right-hand panel listing tool-derived sources with a detail pane. */
export function QaSourcesDrawer({ sources, onClose }: QaSourcesDrawerProps) {
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail =
    detailId === null
      ? undefined
      : sources.find((source) => source.id === detailId);
  return (
    <aside className="dsh-qa-sources" aria-label="Источники">
      <div className="dsh-qa-sources__head">
        <span>
          {detail === undefined ? `Источники (${sources.length})` : "Источник"}
        </span>
        <button
          type="button"
          aria-label="Закрыть источники"
          title="Закрыть"
          onClick={onClose}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4 4 8 8m0-8-8 8" />
          </svg>
        </button>
      </div>
      {detail === undefined ? (
        <div className="dsh-qa-sources__list">
          {sources.map((source) => (
            <QaSourceCard
              key={source.id}
              source={source}
              onOpen={() => setDetailId(source.id)}
            />
          ))}
        </div>
      ) : (
        <QaSourceDetail source={detail} onBack={() => setDetailId(null)} />
      )}
    </aside>
  );
}
