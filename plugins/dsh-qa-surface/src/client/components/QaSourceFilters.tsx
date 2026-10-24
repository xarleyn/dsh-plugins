import type { QaSource } from "../../types.js";
import { KIND_LABELS } from "./source-icon.js";

export function matchesSourceText(source: QaSource, query: string): boolean {
  const words = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  const text = [
    source.title,
    source.uri,
    source.path,
    source.snippet,
    source.content,
  ]
    .filter(Boolean)
    .join("\n")
    .toLocaleLowerCase();
  return words.every((word) => text.includes(word));
}

export function QaSourceFilters({
  sources,
  query,
  kind,
  count,
  onQuery,
  onKind,
  onReset,
}: {
  readonly sources: readonly QaSource[];
  readonly query: string;
  readonly kind: QaSource["kind"] | "all";
  readonly count: number;
  readonly onQuery: (value: string) => void;
  readonly onKind: (value: QaSource["kind"] | "all") => void;
  readonly onReset: () => void;
}) {
  return (
    <div className="dsh-qa-sourcefilters" data-testid="qa-source-filters">
      <input
        type="search"
        aria-label="Поиск по тексту или ссылке"
        placeholder="Поиск по тексту или ссылке"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
      />
      <select
        aria-label="Тип источника"
        value={kind}
        onChange={(event) => onKind(event.target.value as typeof kind)}
      >
        <option value="all">Все типы ({sources.length})</option>
        {Object.entries(KIND_LABELS)
          .filter(
            ([key]) =>
              sources.some((source) => source.kind === key) || kind === key,
          )
          .map(([key, label]) => (
            <option key={key} value={key}>
              {label} ({sources.filter((source) => source.kind === key).length})
            </option>
          ))}
      </select>
      <span className="dsh-qa-sourcefilters__count" role="status">
        Найдено {count} из {sources.length}
      </span>
      {query !== "" || kind !== "all" ? (
        <button type="button" onClick={onReset}>
          Сбросить фильтры
        </button>
      ) : null}
    </div>
  );
}
