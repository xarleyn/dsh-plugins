/** Shared time formatting for the QA surface UI. */

/** `только что`, `5 мин`, `3 ч`, `2 дн` or a ru-RU date past the week. */
export function relativeTime(timestamp: number, now: number): string {
  const seconds = Math.max(1, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return "только что";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} дн`;
  return new Date(timestamp).toLocaleDateString("ru-RU");
}

/** `9 сент 15:44` - compact ru-RU day/month plus time. */
export function formatDayTime(timestamp: number): string {
  const date = new Date(timestamp);
  const month = date
    .toLocaleDateString("ru-RU", { month: "short" })
    .replace(".", "");
  const time = date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date.getDate()} ${month} ${time}`;
}

/** `1,1 с` below ten seconds, `8 с` above. */
export function formatSeconds(ms: number): string {
  const seconds = ms / 1_000;
  const value =
    seconds < 10
      ? (Math.round(seconds * 10) / 10).toString()
      : String(Math.round(seconds));
  return `${value.replace(".", ",")} с`;
}

export function formatWorkDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1_000));
  if (seconds < 1) return "< 1 с";
  if (seconds < 60) return `${seconds} с`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes} мин` : `${minutes} мин ${remainder} с`;
}
