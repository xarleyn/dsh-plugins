import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import domainExpertsRemote from "@yadsh/dsh-domain-experts/remote";
import {
  DomainExpertsPage,
  type DomainExpertsApi,
} from "./DomainExpertsPage.js";
import { DOMAIN_EXPERTS_STYLES } from "./styles.js";
import {
  toOutcome,
  type DomainExpertsClientRemote,
  type DomainExpertsRemote,
} from "./remote.js";
import { currentSessionId } from "./session-id.js";

export const inject = ["slots", "remote", "sessions"];

const STYLE_MARKER = "dsh-domain-experts";

/**
 * Browser half of the plugin.
 *
 * It mounts the generated Remote contribution, adapts the two-layer result
 * shape into one outcome, and registers one page in the Plugins settings
 * section. Everything it displays comes from the host service: the page never
 * decides policy, so the same service can back a CLI or an API later.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const remote = ctx.remote as DomainExpertsClientRemote;
  const disposeRemote = await remote.$mount(domainExpertsRemote);

  const cleanups: (() => void)[] = [injectStyles()];
  let disposeSlot: (() => void) | undefined;
  try {
    /*
     * The mounted namespace is a service of its own: `remote.domainExperts`
     * only resolves on a context that declares it, so the page is registered
     * from inside that scope rather than from the plugin's own context. The
     * callback is re-entered if the namespace is withdrawn and re-provided, so
     * each pass replaces the previous registration instead of stacking one.
     */
    await ctx.inject(["remote.domainExperts"], (remoteContext) => {
      const namespace = (remoteContext.remote as DomainExpertsClientRemote)
        .domainExperts;
      disposeSlot?.();
      disposeSlot = ctx.slots.inject("settings.plugins.tab", () =>
        ctx.slots.register(
          {
            name: "settings.plugins.tab",
            id: "domain-experts",
            order: 20,
            label: () => "Domain Experts",
            inject: () => ({
              api: createApi(namespace),
              currentSessionId: (): string => currentSessionId(ctx),
            }),
          },
          DomainExpertsPage,
        ),
      );
    });
  } catch (error) {
    disposeSlot?.();
    for (const cleanup of cleanups) cleanup();
    await disposeRemote();
    throw error;
  }

  return async () => {
    disposeSlot?.();
    for (const cleanup of cleanups) cleanup();
    await disposeRemote();
  };
}

/** Translate the Remote envelope pairs into the page's single outcome shape. */
function createApi(namespace: DomainExpertsRemote): DomainExpertsApi {
  return {
    listDomains: async () => toOutcome(await namespace.listDomains()),
    getDomain: async (id) => toOutcome(await namespace.getDomain(id)),
    draftDomain: async (id) => toOutcome(await namespace.draftDomain(id)),
    inspectDraft: async (definition) =>
      toOutcome(await namespace.inspectDraft(definition)),
    createDomain: async (definition) =>
      toOutcome(await namespace.createDomain(definition)),
    updateDomain: async (definition) =>
      toOutcome(await namespace.updateDomain(definition)),
    setDomainEnabled: async (id, enabled) =>
      toOutcome(await namespace.setDomainEnabled(id, enabled)),
    deleteDomain: async (id) => toOutcome(await namespace.deleteDomain(id)),
    resolveScope: async (id) => toOutcome(await namespace.resolveScope(id)),
    catalog: async () => toOutcome(await namespace.catalog()),
    inspectMemory: async (id, memoryNamespace, limit) =>
      toOutcome(await namespace.inspectMemory(id, memoryNamespace, limit)),
    clearMemory: async (id, memoryNamespace) =>
      toOutcome(await namespace.clearMemory(id, memoryNamespace)),
    testExpert: async (id, task, parentSessionId) =>
      toOutcome(await namespace.testExpert(id, task, parentSessionId)),
  };
}

/**
 * Inject the page stylesheet once, tagged so a reload replaces rather than
 * stacks it. Returns the disposer that removes the node.
 */
function injectStyles(): () => void {
  if (typeof document === "undefined") return () => undefined;
  const existing = document.querySelector(
    `style[data-plugin="${STYLE_MARKER}"]`,
  );
  if (existing !== null) existing.remove();
  const style = document.createElement("style");
  style.setAttribute("data-plugin", STYLE_MARKER);
  style.textContent = DOMAIN_EXPERTS_STYLES;
  document.head.append(style);
  return () => {
    style.remove();
  };
}
