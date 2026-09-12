const SETTLED_HEAD =
  /^Background subagent ([0-9a-f][0-9a-f-]*) (finished|was stopped|ran out of room|declined the task|failed)/u;
const SETTLED_CLOSING = "Its closing message:";
const SETTLED_TITLES: Readonly<Record<string, string>> = Object.freeze({
  finished: "завершён",
  "was stopped": "остановлен",
  "ran out of room": "упёрся в лимит длины",
  "declined the task": "отклонил задачу",
  failed: "завершился ошибкой",
});

/** Fold the host settlement wording into a title plus the closing message. */
export function parseSettlement(
  text: string,
): { title: string; body: string } | undefined {
  const head = SETTLED_HEAD.exec(text);
  if (head === null) return undefined;
  const id = (head[1] ?? "").slice(0, 8);
  const title = `Субагент ${id} ${SETTLED_TITLES[head[2] ?? "finished"] ?? "завершён"}`;
  const closeAt = text.indexOf(SETTLED_CLOSING);
  const body =
    closeAt === -1 ? "" : text.slice(closeAt + SETTLED_CLOSING.length).trim();
  return {
    title,
    body: body.length <= 4_000 ? body : `${body.slice(0, 3_999)}…`,
  };
}
