import type { QaSessionState } from "../../types.js";

/**
 * Small pure projections of the session state shared by surface regions: the
 * composer's status line and the conversation title. Keeping them out of
 * QaSurface leaves that file pure composition.
 */

/** The composer's status line, or null when nothing is due. */
export function statusText(
  state: QaSessionState,
  runningPhrase: string | null,
): string | null {
  if (state.pendingMessage !== null) return "Подготавливаю ответ…";
  if (state.phase === "creating") return "Подключаюсь…";
  if (state.phase === "reconnecting")
    return "Связь потерялась. Подключаюсь снова…";
  if (state.phase === "running") return runningPhrase;
  return null;
}

/** The conversation title derived from the first user prompt, clipped. */
export function titleFromMessages(state: QaSessionState): string | null {
  const firstUser = state.messages.find((message) => message.role === "user");
  if (firstUser === undefined) return null;
  const title = firstUser.text.replace(/\s+/gu, " ").trim();
  if (title === "") return null;
  if (title.length <= 52) return title;
  return `${title.slice(0, 51).trimEnd()}…`;
}
