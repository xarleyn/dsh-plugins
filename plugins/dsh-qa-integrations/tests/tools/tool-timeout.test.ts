import { resolveConfig } from "../../src/config.js";
import { RETRY_CAP_MS } from "../../src/providers/kernel/read-policy.js";
import { createIntegrationTools } from "../../src/tools.js";

/**
 * The harness only arms `TOOL_TIMEOUT` for a tool that declares a budget, so a
 * tool that declares none can hold a chat turn open for as long as its upstream
 * likes and nothing in the transcript says which call did it.
 *
 * The two bounds below are read off the code that sets them rather than off the
 * declaration itself: the transport loop's own retry budget says what one read
 * may cost, and the surface's `/ask` round says what a chat turn may cost. A
 * declaration between them is the claim that a tool gave up before the answer
 * arrived only because it was told to, not because it hung.
 */

/** What one chat round may spend, owned by the QA surface rather than by us. */
const ASK_BUDGET_MS = 600_000;

/**
 * How many upstream reads one tool call can chain: a boundary probe, the
 * reading itself, and one included collection. Each of them pays the retry
 * budget separately, so a call costs this many times a read.
 */
const READS_PER_CALL = 3;

function tools() {
  return createIntegrationTools({
    broker: { call: async () => undefined } as never,
    principalForSession: () => undefined,
  });
}

/**
 * The worst case of one fully retried read at the shipped defaults.
 *
 * The deadline is the widest one any provider arms — the streaming reads of a
 * log, an artifact or an attachment keep their own, longer budget — because the
 * declaration has to hold for the call that pays it. `retries` is read from the
 * providers that declare it: one transport dials a single attempt on purpose and
 * so names no retries at all.
 */
function worstCaseRead(): number {
  const config = resolveConfig();
  const retries = Math.max(
    config.confluence.retries,
    config.gitlab.retries,
    config.jira.retries,
    config.teamcity.retries,
    config.testit.retries,
    config.weblate.retries,
  );
  const deadline = Math.max(
    config.timeoutMs,
    config.teamcity.streamTimeoutMs,
    config.testit.attachmentTimeoutMs,
  );
  // `(retries + 1)` attempts of `deadline` each — the budget is re-paid by a
  // provider that re-sends every fault — plus one capped backoff per retry.
  return (retries + 1) * deadline + retries * RETRY_CAP_MS;
}

describe("integration tool timeout", () => {
  it("declares a budget on every mounted tool", () => {
    const definitions = tools();
    expect(definitions.length).toBeGreaterThan(0);
    for (const definition of definitions) {
      expect(definition.timeoutMs, definition.name).toBeGreaterThan(0);
    }
  });

  it("sits above the retry budget a call can cost and below the ask budget", () => {
    const ceiling = worstCaseRead() * READS_PER_CALL;
    for (const definition of tools()) {
      expect(definition.timeoutMs, definition.name).toBeGreaterThan(ceiling);
      expect(definition.timeoutMs, definition.name).toBeLessThan(ASK_BUDGET_MS);
    }
  });

  it("keeps the budget out of the model-facing schema", () => {
    // The deadline is ours: a parameter that names it would invite the model to
    // negotiate with a budget it cannot change.
    for (const definition of tools()) {
      expect(JSON.stringify(definition.parameters)).not.toMatch(/timeout/iu);
    }
  });
});
