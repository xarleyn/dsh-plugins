import type { QaSlashCatalogEntry } from "../types.js";

export type QaSearchSourceEntry = QaSlashCatalogEntry & {
  readonly searchSource: NonNullable<QaSlashCatalogEntry["searchSource"]>;
};

export function isSearchSource(
  entry: QaSlashCatalogEntry,
): entry is QaSearchSourceEntry {
  return entry.kind === "skill" && entry.searchSource !== undefined;
}

export function sourceLabel({
  label,
}: QaSearchSourceEntry["searchSource"]): string {
  return label;
}

/** A human-readable receipt survives native history, queued sends and reloads. */
export function sourcePrompt(
  entry: QaSearchSourceEntry,
  question: string,
): string {
  return (
    "/" +
    entry.name +
    "\nИсточник поиска: " +
    sourceLabel(entry.searchSource) +
    "\n\n" +
    question
  );
}

export function readSourcePrompt(text: string) {
  const match =
    /^(?:\/no-review\s+)?\/([a-z0-9]+(?:-[a-z0-9]+)*)\nИсточник поиска: ([^\r\n]+)(?:\n\n|$)/u.exec(
      text,
    );
  if (!match) return undefined;
  return {
    skill: match[1],
    label: match[2],
    question: text.slice(match[0].length),
  };
}
