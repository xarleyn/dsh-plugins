import type { Session } from "@deepseek-ai/dsh-session";

/**
 * The durable activation marker, read back from the session log.
 *
 * The marker is not an event of its own. `qa-surface` deliberately appends no
 * custom session type: a reader that does not mount this plugin refuses a log
 * containing an unknown non-`ignorable` type, which would make every activated
 * session unreadable in a plain DSH deployment. Instead the activation is
 * derived from the `skill` tool call the model already made — a standard
 * `tool/call` paired with a successful `tool/result`, both of which every
 * harness build understands and neither of which this plugin writes.
 *
 * Consequence: restoration trusts the same fact the live detector does, and a
 * deployment that drops the `skill` tool cannot restore. That is the correct
 * trade — the tool is an operator's deliberate grant, and the log stays
 * portable.
 */

/** Rendered `skill` result prefix emitted by `@deepseek-ai/dsh-tool-skill`. */
const SKILL_CONTENT = /<skill_content name="([^"]*)">/u;

/** The skill-loader tool whose successful result is the activation marker. */
const SKILL_TOOL = "skill";

/** `tool/call` data: the tool name and the call id its result will carry. */
function toolCallData(data: unknown): { readonly callId: string } | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const record = data as Record<string, unknown>;
  return record.name === SKILL_TOOL && typeof record.callId === "string"
    ? { callId: record.callId }
    : undefined;
}

/** The tool-result blocks of one result event, paired with their call identity. */
interface ResultBlocks {
  readonly callIds: readonly string[];
  readonly texts: readonly string[];
  readonly isError: boolean;
}

/** Every text fragment nested under a model content value, at any depth. */
function collectTexts(value: unknown, into: string[]): void {
  if (typeof value === "string") {
    into.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTexts(item, into);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") into.push(record.text);
  if (Array.isArray(record.content)) collectTexts(record.content, into);
}

/**
 * Read one `tool/result` event: the call it answers, the text it carried, and
 * whether it failed. Text is collected recursively because a tool result wraps
 * its blocks in a `tool_result` block whose own `content` holds the text the
 * model saw.
 */
function resultBlocks(data: unknown): ResultBlocks | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const message = (data as Record<string, unknown>).message;
  if (typeof message !== "object" || message === null) return undefined;
  const content = (message as Record<string, unknown>).content;
  if (!Array.isArray(content)) return undefined;
  const callIds: string[] = [];
  const texts: string[] = [];
  let isError = false;
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const record = block as Record<string, unknown>;
    if (typeof record.callId === "string") callIds.push(record.callId);
    if (record.isError === true) isError = true;
    collectTexts(record.content, texts);
  }
  return { callIds, texts, isError };
}

/**
 * Whether one session's log shows the configured skill was successfully loaded.
 *
 * Pairs each `tool/call` for the `skill` tool with its `tool/result`, then reads
 * the loaded skill's name from the canonical rendered content. The rendered
 * block is the only record of the returned skill identity that survives to the
 * log — `tool/result` stores the model-facing message, not the tool's canonical
 * value — and the pair closes only on a non-error result, so a refused or
 * failed load never counts.
 * @param session - the live session to inspect.
 * @param skillName - the configured activation skill name.
 * @returns whether that skill was loaded and its result succeeded.
 */
export function sessionLoadedSkill(
  session: Pick<Session, "snapshotEvents">,
  skillName: string,
): boolean {
  const skillCalls = new Set<string>();
  for (const event of session.snapshotEvents()) {
    if (event.type === "tool/call") {
      const call = toolCallData(event.data);
      if (call !== undefined) skillCalls.add(call.callId);
      continue;
    }
    if (event.type !== "tool/result") continue;
    const blocks = resultBlocks(event.data);
    if (blocks === undefined || blocks.isError) continue;
    if (!blocks.callIds.some((callId) => skillCalls.has(callId))) continue;
    for (const text of blocks.texts) {
      if (SKILL_CONTENT.exec(text)?.[1] === skillName) return true;
    }
  }
  return false;
}
