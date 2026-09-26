import type { QaSource } from "../../types.js";

/**
 * Leaf source-kind vocabulary: the icon and the group labels a kind wears.
 * Kept free of component imports so the markdown renderer's chips can share
 * it without pulling the sources panel (and its markdown dependency) into
 * every inline parse.
 */

export const KIND_LABELS: Readonly<Record<QaSource["kind"], string>> = {
  file: "Документы",
  code: "Код",
  web: "Web",
  jira: "Jira",
  confluence: "Confluence",
  knowledge: "База знаний",
  other: "Другие",
};

export function SourceIcon({ kind }: { readonly kind: QaSource["kind"] }) {
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
