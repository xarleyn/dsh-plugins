import { codenameFor } from "./subagent-codenames.js";

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
/** Prefix length of the raw session id shown when no readable name exists. */
const SHORT_ID_LENGTH = 8;
/** Longest readable name shown in a notice title before it is cut. */
const NAME_LIMIT = 48;
/** Body cap shared with the closing-message fold below. */
const BODY_LIMIT = 4_000;

/** Raw pieces of one settlement notice, before display naming. */
export interface SettledSubagent {
  /** Full child session id the host named in the notice. */
  readonly id: string;
  /** Russian completion verb phrase ("завершён", "остановлен", …). */
  readonly ending: string;
  /** The child's closing message, trimmed and capped. */
  readonly body: string;
}

/** Fold the host settlement wording into its raw pieces. */
export function parseSettlement(text: string): SettledSubagent | undefined {
  const head = SETTLED_HEAD.exec(text);
  if (head === null) return undefined;
  const closeAt = text.indexOf(SETTLED_CLOSING);
  const body =
    closeAt === -1 ? "" : text.slice(closeAt + SETTLED_CLOSING.length).trim();
  return {
    id: head[1] ?? "",
    ending: SETTLED_TITLES[head[2] ?? "finished"] ?? "завершён",
    body:
      body.length <= BODY_LIMIT ? body : `${body.slice(0, BODY_LIMIT - 1)}…`,
  };
}

/** Operator-facing view of one settled subagent. */
export interface SettlementView {
  readonly title: string;
  readonly body: string;
  /**
   * Muted correlation lines above the body, one fact per line; absent when
   * the title says it all.
   */
  readonly meta?: string;
}

/**
 * A list title the operator can read: whitespace-collapsed, and not the
 * session id itself — the host falls back to the raw id where a child has no
 * title of its own, and a hash is exactly what this module exists to hide.
 */
export function readableSubagentName(
  title: string | undefined,
  id: string,
): string | undefined {
  if (title === undefined) return undefined;
  const flat = title.replace(/\s+/gu, " ").trim();
  if (flat === "" || flat === id) return undefined;
  return flat.length <= NAME_LIMIT ? flat : `${flat.slice(0, NAME_LIMIT - 1)}…`;
}

export interface SettlementViewOptions {
  /**
   * The chat's subagent display names keyed by session id (the delegation
   * description the host keeps, or the session's own title).
   */
  readonly nameOf?: (id: string) => string | undefined;
  /** Sign titles with deterministic codenames instead of the raw name or id. */
  readonly codenames?: boolean;
}

/**
 * Build the operator-facing title for one settled subagent. A codename wins
 * when enabled, then the child's readable name, and the short id stands in
 * when neither exists. The folded-out facts move into the meta line: the
 * real task name under a codename, and the id wherever the title does not
 * already carry it, so a notice stays matchable against the session logs.
 */
export function settlementView(
  settled: SettledSubagent,
  options: SettlementViewOptions = {},
): SettlementView {
  const shortId = settled.id.slice(0, SHORT_ID_LENGTH);
  const name = readableSubagentName(options.nameOf?.(settled.id), settled.id);
  const codename =
    options.codenames === true && settled.id !== ""
      ? codenameFor(settled.id)
      : undefined;
  const subject = codename ?? name ?? shortId;
  const metaParts: string[] = [];
  if (codename !== undefined && name !== undefined)
    metaParts.push(`Задача: ${name}`);
  if (subject !== shortId) metaParts.push(`Идентификатор: ${shortId}`);
  return {
    title:
      subject === shortId
        ? `Субагент ${shortId} ${settled.ending}`
        : `Субагент «${subject}» ${settled.ending}`,
    body: settled.body,
    ...(metaParts.length === 0 ? {} : { meta: metaParts.join("\n") }),
  };
}
