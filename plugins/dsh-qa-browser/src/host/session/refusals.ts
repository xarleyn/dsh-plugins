/**
 * The channel the policy's refusals travel on.
 *
 * A destination the network policy blocks is not an error the operator can be
 * shown by exception alone — a page that keeps failing on one host looks like a
 * broken site — so every refusal is filed against the tab whose page dialled
 * it, counted per destination, and read back by the panel. Which destinations
 * are allowed is the policy's own decision (`../policy.ts`, and #344 for the
 * classification); this module only keeps the answers the operator sees.
 */
import { QaBrowserError } from "../../errors.js";
import type { BrowserPolicyRefusal, BrowserRequestKind } from "../../types.js";
import type { SessionKernel } from "./kernel.js";
import {
  MAX_POLICY_REFUSALS,
  refusalHost,
  type SessionRecord,
  type TabRecord,
} from "./records.js";

/**
 * The refusals that belong to no tab, oldest first.
 *
 * A refusal normally travels with the tab whose page made the request and is
 * read through the panel's tab list; this is the residue — a request the
 * context dialled with no page behind it — and the panel shows it beside the
 * selected tab's own entries. A session the manager does not hold (never
 * started, already evicted) has refused nothing.
 */
export function sessionPolicyRefusals(
  kernel: SessionKernel,
  sessionId: string,
): readonly BrowserPolicyRefusal[] {
  const refusals = kernel.sessions.get(sessionId)?.policyRefusals;
  return refusals === undefined ? [] : [...refusals];
}

/**
 * The policy gate the agent's own navigation passes, with the refusal kept
 * when it closes.
 */
export async function assertPolicyAllowed(
  kernel: SessionKernel,
  record: SessionRecord,
  tab: TabRecord,
  url: string,
  kind: BrowserRequestKind,
): Promise<void> {
  try {
    await kernel.options.policy.assertAllowed(url);
  } catch (error) {
    notePolicyRefusal(kernel, record, tab, url, kind, error);
    throw error;
  }
}

/**
 * Keep a refusal for the panel and the host log.
 *
 * One entry per destination: a page that keeps retrying a blocked endpoint
 * is one thing to fix, so a repeat raises the count instead of appending
 * another row. The entry goes to `tab` when the request has a page and to the
 * session's untabbed list when it has none.
 *
 * `record` may be absent only when the session is already gone — a context
 * that outlives its record while it is being torn down — and what it refused
 * still belongs in the log. A record that is merely young is registered
 * before its first tab exists, precisely so this lookup finds it.
 */
export function notePolicyRefusal(
  kernel: SessionKernel,
  record: SessionRecord | undefined,
  tab: TabRecord | undefined,
  url: string,
  kind: BrowserRequestKind,
  error: unknown,
): void {
  if (!(error instanceof QaBrowserError)) return;
  const host = refusalHost(url);
  const refusals = tab?.policyRefusals ?? record?.policyRefusals;
  if (refusals !== undefined) {
    const index = refusals.findIndex(
      (entry) =>
        entry.code === error.code && entry.kind === kind && entry.host === host,
    );
    if (index === -1) {
      if (refusals.length < MAX_POLICY_REFUSALS) {
        refusals.push({
          code: error.code,
          kind,
          host,
          message: error.message,
          count: 1,
        });
      }
    } else {
      const known = refusals[index]!;
      refusals[index] = {
        ...known,
        message: error.message,
        count: known.count + 1,
      };
    }
  }
  kernel.logger.warn("browser.policy-refused", {
    sessionId: record?.sessionId ?? null,
    tabId: tab?.id ?? null,
    code: error.code,
    kind,
    host,
  });
}

/**
 * A new page starts with a clean notice: the entries describe how one page
 * stands with the policy, so carrying the previous page's blocked endpoint
 * into the next one would explain a page that is no longer on screen.
 *
 * Only the navigating tab is cleared — a second tab keeps the explanation of
 * the page it is still showing — and the untabbed list goes with it, because
 * a request with no page belongs to the document that was on screen when it
 * was dialled.
 */
export function clearPolicyRefusals(
  record: SessionRecord,
  tab?: TabRecord,
): void {
  if (tab !== undefined) tab.policyRefusals = [];
  record.policyRefusals = [];
}
