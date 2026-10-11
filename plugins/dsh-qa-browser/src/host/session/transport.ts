/**
 * How a request reaches a page and how its answer is shaped.
 *
 * One tab is mutated by one action at a time, so every action joins the tab's
 * queue and the queue is where the session is marked busy — which is what the
 * lease handover waits on. The control check an action needs (agent, human, or
 * none) is the only thing that differs between the wrappers below.
 */
import { QaBrowserError } from "../../errors.js";
import type { BrowserActionResult, LocatorPlan } from "../../types.js";
import type { SessionKernel } from "./kernel.js";
import { advanceRevision, refreshTab, requireRef } from "./registry.js";
import type { SessionRecord, TabRecord } from "./records.js";

export function enqueue<T>(
  kernel: SessionKernel,
  record: SessionRecord,
  tab: TabRecord,
  action: () => Promise<T>,
): Promise<T> {
  const run = tab.queue.then(async () => {
    if (tab.status === "closed") {
      throw new QaBrowserError("BROWSER_TAB_CLOSED", "Browser tab is closed.");
    }
    record.activeActions += 1;
    kernel.touch(record);
    try {
      return await action();
    } finally {
      record.activeActions -= 1;
      kernel.touch(record);
    }
  });
  tab.queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function runSessionMutation<T>(
  kernel: SessionKernel,
  record: SessionRecord,
  action: () => Promise<T>,
): Promise<T> {
  kernel.assertAgentControl(record);
  record.activeActions += 1;
  kernel.touch(record);
  try {
    return await action();
  } finally {
    record.activeActions -= 1;
    kernel.touch(record);
  }
}

/** The human-held twin of {@link runSessionMutation}, for whole-session work. */
export async function runHumanSessionMutation<T>(
  kernel: SessionKernel,
  record: SessionRecord,
  clientId: string,
  action: () => Promise<T>,
): Promise<T> {
  kernel.assertHumanControl(record, clientId);
  record.activeActions += 1;
  kernel.touch(record);
  try {
    return await action();
  } finally {
    record.activeActions -= 1;
    kernel.touch(record);
  }
}

export function enqueueMutation<T>(
  kernel: SessionKernel,
  record: SessionRecord,
  tab: TabRecord,
  action: () => Promise<T>,
): Promise<T> {
  return enqueue(kernel, record, tab, async () => {
    kernel.assertAgentControl(record);
    return action();
  });
}

export function enqueueHuman<T>(
  kernel: SessionKernel,
  record: SessionRecord,
  tab: TabRecord,
  clientId: string,
  action: () => Promise<T>,
): Promise<T> {
  return enqueue(kernel, record, tab, async () => {
    kernel.assertHumanControl(record, clientId);
    return action();
  });
}

export async function refAction(
  kernel: SessionKernel,
  sessionId: string,
  id: string,
  ref: string,
  verb: string,
  action: (tab: TabRecord, locator: LocatorPlan) => Promise<void>,
): Promise<BrowserActionResult> {
  const record = kernel.requireSession(sessionId);
  const tab = kernel.requireTab(record, id);
  return enqueueMutation(kernel, record, tab, async () => {
    const target = requireRef(tab, ref);
    await tab.page.validateLocator(target.locator);
    await action(tab, target.locator);
    return finishMutation(kernel, record, tab, `${verb} [${ref}].`);
  });
}

export async function finishMutation(
  kernel: SessionKernel,
  record: SessionRecord,
  tab: TabRecord,
  summary: string,
  navigation?: BrowserActionResult["navigation"],
): Promise<BrowserActionResult> {
  await refreshTab(kernel, tab, false);
  advanceRevision(tab);
  return actionResult(record, tab, summary, navigation);
}

export function actionResult(
  record: SessionRecord,
  tab: TabRecord,
  summary: string,
  navigation?: BrowserActionResult["navigation"],
): BrowserActionResult {
  return {
    ok: true,
    sessionId: record.sessionId,
    tabId: tab.id,
    revision: tab.revision,
    url: tab.url,
    title: tab.title,
    summary,
    ...(navigation === undefined ? {} : { navigation }),
  };
}
