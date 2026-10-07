import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-api-gateway/client";
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type { ConfigForm } from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {
  InjectFace,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import promptFirewallRemote from "@yadsh/dsh-prompt-firewall/remote";
import {
  bindSettingsExternalStore,
  injectCardStyles,
  startVisibilityAwarePolling,
} from "@yadsh/dsh-plugin-kit/client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  PromptFirewallConfig,
  PromptFirewallInspectorSnapshot,
  SectionPolicy,
} from "../types.js";
import { styles } from "./styles.js";
import {
  AuditSection,
  InspectorSection,
  LastRequestSection,
  PolicySection,
  RulesSection,
} from "./sections.js";

/** The settings namespace is the Host profile entry id. */
const SETTINGS_NAMESPACE = "dsh-prompt-firewall";
const REFRESH_INTERVAL_MS = 3_000;

/**
 * The one-liner of this bundle's row.
 *
 * Kept equal to `meta.description` of `locale/en.json`, which is where the Host
 * reads the row's sentence from; this answer is what the same row says if that
 * field were ever dropped, so one row cannot describe two pages. Pinned by a test.
 */
export const PROMPT_FIREWALL_ROW_SUMMARY =
  "Prompt hygiene, section policy, and request-level observability.";

interface InspectorRemote {
  inspect(): Promise<RemoteResult<PromptFirewallInspectorSnapshot>>;
  setSectionPolicy(
    name: string,
    policy: SectionPolicy,
    expectedRevision?: number,
  ): Promise<RemoteResult<void>>;
}

interface ClientRemote {
  $mount(contribution: TypertRemoteContribution): Promise<() => Promise<void>>;
  promptFirewall: InspectorRemote;
}

/**
 * The face the row seat injects into this card.
 *
 * The form travels as `settingsForm`, not `form`: the seat hands its registrant a
 * `form` of its own — the Host's `ConfigPageForm`, only `{ state, mutate }`, which
 * can neither be subscribed to nor written field by field — and spreads that owner
 * prop *after* this face, so a form named `form` would be overwritten in the
 * operator's browser rather than in a test.
 */
interface CardFace {
  settingsForm: ConfigForm<PromptFirewallConfig>;
  inspect: InspectorRemote["inspect"];
  setSectionPolicy: InspectorRemote["setSectionPolicy"];
}

type CardProps = PropsRuntime<"plugins.row.config"> & InjectFace<CardFace>;

function displayError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Could not load Prompt Inspector data.";
}

function PromptFirewallCard({
  settingsForm: form,
  inspect,
  setSectionPolicy,
}: CardProps) {
  const settingsStore = useMemo(() => bindSettingsExternalStore(form), [form]);
  const settings = useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot,
    settingsStore.getSnapshot,
  );
  const config = settings.value;
  const writable = settings.status === "ready" && settings.writable;
  const [inspector, setInspector] =
    useState<PromptFirewallInspectorSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const activeRequest = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++activeRequest.current;
    setRefreshing(true);
    try {
      const result = await inspect();
      if (request !== activeRequest.current) return;
      if (result.ok) {
        setInspector(result.value);
        setError(null);
      } else {
        setError(displayError(result.error));
      }
    } catch (cause) {
      if (request === activeRequest.current) setError(displayError(cause));
    } finally {
      if (request === activeRequest.current) setRefreshing(false);
    }
  }, [inspect]);

  useEffect(() => {
    const stopPolling = startVisibilityAwarePolling(
      refresh,
      REFRESH_INTERVAL_MS,
    );
    return () => {
      stopPolling();
      activeRequest.current += 1;
    };
  }, [refresh]);

  const setPath = useCallback(
    (path: string[], value: unknown) => {
      const [field, nested] = path;
      if (field === undefined) return;
      if (nested === undefined) {
        void form.set(field, value);
        return;
      }
      const current = form.getSnapshot().value;
      const parent = field === "audit" ? current?.audit : current?.metrics;
      void form.set(field, { ...parent, [nested]: value });
    },
    [form],
  );

  const setPolicy = useCallback(
    async (name: string, policy: SectionPolicy) => {
      const current = form.getSnapshot();
      const result = await setSectionPolicy(name, policy, current.revision);
      if (!result.ok) setError(displayError(result.error));
      await refresh();
    },
    [form, refresh, setSectionPolicy],
  );

  return (
    /*
     * The Plugins page draws this card's frame, its heading and its expand control
     * around the body, so the bundle renders the body and nothing around it — a
     * shell of ours here is a second frame and a second heading next to the
     * first-party rows (AGENTS.md, card-shell contract). The `enabled` state the old
     * header badge carried is the first switch of the Policy section, where it is
     * also something the operator can act on.
     */
    <div className="pf-body" data-testid="pf-settings">
      {settings.status === "unavailable" ? (
        /*
         * The row opens onto a section the Host will not serve, and a card that
         * returns nothing leaves an expanded row silent with no reason: the settings
         * directory is loopback-only, so this is what a browser on the LAN reads. The
         * write controls below disable themselves off the same snapshot.
         */
        <div className="pf-notice" data-testid="pf-settings-unavailable">
          This browser cannot read or write the deployment&apos;s settings. The
          firewall keeps enforcing the last policy the Host accepted.
        </div>
      ) : null}

      {error !== null && (
        <div className="pf-error" data-testid="pf-error">
          {error}
        </div>
      )}

      <PolicySection
        config={config}
        writable={writable}
        setPath={setPath}
        unsetPreset={() => {
          void form.unset("preset");
        }}
      />
      <LastRequestSection
        config={config}
        inspector={inspector}
        refreshing={refreshing}
        onRefresh={() => {
          void refresh();
        }}
      />
      <RulesSection config={config} writable={writable} setPath={setPath} />
      <AuditSection config={config} writable={writable} setPath={setPath} />
      <InspectorSection
        inspector={inspector}
        writable={writable}
        setPolicy={setPolicy}
      />
    </div>
  );
}

/**
 * The entry the Plugins page renders for this bundle's row.
 *
 * The seat is asked for two views of one registrant: `page` is the body below the
 * page's own chrome, and `summary` is the row's one-liner for a row that declares no
 * description — the page drops it into a paragraph of its own, so it stays text and
 * starts no second poll of the Remote.
 */
export function PromptFirewallEntry(props: CardProps) {
  if (props.view === "summary") return PROMPT_FIREWALL_ROW_SUMMARY;
  return <PromptFirewallCard {...props} />;
}

export const inject = ["slots", "remote", "configForms"];

/** Mount the generated Remote contribution and register the Prompt Firewall card. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const remote = ctx.remote as unknown as ClientRemote;
  const disposeRemote = await remote.$mount(promptFirewallRemote);
  const removeStyles = injectCardStyles("dsh-prompt-firewall", styles);
  const form = ctx.configForms.get<PromptFirewallConfig>(SETTINGS_NAMESPACE);
  try {
    await ctx.inject(["remote.promptFirewall"], (remoteCtx) => {
      const injectedRemote = remoteCtx.remote as unknown as ClientRemote;
      const face: CardFace = {
        settingsForm: form,
        inspect: () => injectedRemote.promptFirewall.inspect(),
        setSectionPolicy: (section, policy, revision) =>
          injectedRemote.promptFirewall.setSectionPolicy(
            section,
            policy,
            revision,
          ),
      };

      return ctx.slots.inject("plugins.row.config", () =>
        ctx.slots.register(
          {
            name: "plugins.row.config",
            /*
             * The key joins this bundle's package name to the row id
             * `cordis.patch.yml` declares, and that row id *is* the namespace the Host
             * serves this form under, so the seat and the settings agree without either
             * naming the other — and a value saved before this move is read back after
             * it.
             */
            key: `@yadsh/dsh-prompt-firewall#${SETTINGS_NAMESPACE}`,
            inject: () => face,
          },
          PromptFirewallEntry,
        ),
      );
    });
  } catch (cause) {
    removeStyles();
    await disposeRemote();
    throw cause;
  }

  return async () => {
    removeStyles();
    await disposeRemote();
  };
}
