/** Request-local answer strategy. Fast controls review independently of retrieval. */
export type QaAnswerMode = "fast" | "deep" | "rag";
export const QA_DEFAULT_ANSWER_MODES: readonly QaAnswerMode[] = Object.freeze([
  "deep",
]);
export const QA_ANSWER_MODE_NAMES: Readonly<Record<QaAnswerMode, string>> = {
  fast: "Fast",
  deep: "Deep Thinking",
  rag: "RAG Priority",
};

export function qaAnswerModes(value: unknown): readonly QaAnswerMode[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 3 ||
    value.some((mode) => !["fast", "deep", "rag"].includes(mode)) ||
    new Set(value).size !== value.length
  )
    throw new Error("Choose one or more valid answer modes.");
  return (["fast", "deep", "rag"] as const).filter((mode) =>
    value.includes(mode),
  );
}

export function qaAnswerModeTooltip(mode: QaAnswerMode): string {
  switch (mode) {
    case "fast":
      return "Пропускать автоматическое ревью ответов. Проверка документов перед согласованием сохраняется.";
    case "deep":
      return "Изучать документацию, проверять гипотезы и подключать субагентов. Вместе с RAG Priority глубокий поиск начинается только после вашего согласия.";
    case "rag":
      return "Сначала искать в LightRAG разными запросами и способами поиска. Если данных недостаточно, спросить согласие на глубокий поиск. Без согласия отвечать только по найденному.";
  }
}
