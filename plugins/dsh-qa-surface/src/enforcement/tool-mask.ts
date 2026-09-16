import type { Context } from "@deepseek-ai/cordis";

/** The registry surface one mask needs: a single scoped restriction call. */
export type QaToolMaskTarget = Pick<Context["tools"], "restrict">;

/** One installed mask: how to lift it, and what it could not name. */
export interface QaToolMask {
  /** Lift the mask. A no-op when the registry took no mask at all. */
  readonly dispose: () => void;
  /**
   * Names left out of the mask, in the order they were given up: a name the
   * agent registers for itself never enters a mask, and a name no layer holds
   * is dropped by the registry. Reported so an operator learns that the
   * deployment's allow-list names something this session cannot restrict.
   */
  readonly refused: readonly string[];
}

/** Quoted names in the registry's refusal of unnameable restriction entries. */
const QUOTED_NAME = /"([^"]+)"/gu;

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Install a scoped restriction over the names a QA session may see.
 *
 * `restrict()` filters what a scope INHERITS — the global layer and the
 * ancestor layers, a preset's own tool rows among them. It refuses, with one
 * error, three different things: a name no layer holds, a name the scope
 * registers for itself, and an empty list. The QA tool catalog attaches its
 * tools to the agent itself, so `qa_tools_selfcheck` is exactly the second
 * case, and a single such entry used to make the registry refuse the whole
 * call and fail every chat's attestation.
 *
 * This function therefore filters the self-registered names out first, and
 * then gives up whatever the registry still refuses, one round at a time: an
 * entry the mask cannot name costs that entry, never the session. The caller's
 * execution guard is unaffected — it keeps enforcing the full policy — so an
 * entry that never reaches the mask stays callable and denied, not allowed.
 * @param tools - the agent's scoped registry.
 * @param allow - names the mask should admit, in policy order.
 * @param agentLocal - names the QA catalog registers on the agent itself.
 * @returns the installed mask, plus the names that did not make it in.
 */
export function installInheritableMask(
  tools: QaToolMaskTarget,
  allow: readonly string[],
  agentLocal: ReadonlySet<string>,
): QaToolMask {
  const refused: string[] = [];
  let names = [...new Set(allow)].filter((name) => !agentLocal.has(name));

  while (names.length > 0) {
    try {
      return { dispose: tools.restrict({ allow: names }), refused };
    } catch (error) {
      const rejected = new Set(
        [...messageOf(error).matchAll(QUOTED_NAME)].map((match) => match[1]),
      );
      const next = names.filter((name) => !rejected.has(name));
      if (next.length === names.length) {
        // The refusal named nothing this mask carries — an empty list and an
        // unrecognized failure both land here. Stop instead of looping.
        refused.push(...names);
        return { dispose: () => undefined, refused };
      }
      refused.push(...names.filter((name) => rejected.has(name)));
      names = next;
    }
  }

  // Every name was self-registered: the model surface needs no mask.
  return { dispose: () => undefined, refused };
}
