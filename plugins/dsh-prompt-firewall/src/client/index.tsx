import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-api-gateway/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type { ConfigForm } from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";
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
  CardShell,
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

interface CardFace {
  form: ConfigForm<PromptFirewallConfig>;
  inspect: InspectorRemote["inspect"];
  setSectionPolicy: InspectorRemote["setSectionPolicy"];
}

type CardProps = PropsRuntime<"settings.plugins.tab"> & InjectFace<CardFace>;

function displayError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Could not load Prompt Inspector data.";
}

function PromptFirewallCard({ form, inspect, setSectionPolicy }: CardProps) {
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

  const enabled = config?.enabled ?? true;

  if (settings.status === "unavailable") return null;

  return (
    // The tab surface renders no host list of its own, so the shell's `<li>`
    // root keeps a plugin-owned `<ul>` (AGENTS.md card contract).
    <ul className="pf-settings">
      <CardShell
        title="Prompt Firewall"
        description="Prompt hygiene, section policy, and request-level observability."
        badge={
          <span className="dsh-plugin-card__badge">
            {enabled ? "Enabled" : "Disabled"}
          </span>
        }
        label={(open) => `${open ? "Hide" : "Show"} settings: Prompt Firewall`}
        bodyClassName="pf-body"
      >
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
      </CardShell>
    </ul>
  );
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
        form,
        inspect: () => injectedRemote.promptFirewall.inspect(),
        setSectionPolicy: (section, policy, revision) =>
          injectedRemote.promptFirewall.setSectionPolicy(
            section,
            policy,
            revision,
          ),
      };

      return ctx.slots.inject("settings.plugins.tab", () =>
        ctx.slots.register(
          {
            name: "settings.plugins.tab",
            id: SETTINGS_NAMESPACE,
            order: 30,
            label: () => "Prompt Firewall",
            inject: () => face,
          },
          PromptFirewallCard,
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
