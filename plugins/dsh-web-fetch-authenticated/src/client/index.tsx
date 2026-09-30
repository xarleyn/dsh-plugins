import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {
  InjectFace,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import webFetchAuthRemote from "@yadsh/dsh-web-fetch-authenticated/remote";
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
import { validateConfig } from "../rule-validation.js";
import type {
  AuthenticatedFetchRule,
  DiagnoseReport,
  ProviderStatusReport,
  RuleTestReport,
  WebFetchAuthConfig,
} from "../types.js";
import { WEB_FETCH_AUTH_SETTINGS_NAMESPACE } from "../types.js";
import { styles } from "./styles.js";
import {
  DiagnosticsSection,
  GlobalSection,
  RulesSection,
  StatusSection,
  type CardFace,
  type CredentialsRemote,
} from "./sections.js";

const REFRESH_INTERVAL_MS = 5_000;

// The Plugins page keys a row's configuration by `<package name>#<row id>`,
// and the page resolves the Host form for the row id as the settings
// namespace — both facts come from this package's `cordis.patch.yml` row.
const WEB_FETCH_AUTH_ROW_CONFIG_KEY = `@yadsh/dsh-web-fetch-authenticated#${WEB_FETCH_AUTH_SETTINGS_NAMESPACE}`;

/**
 * What the row does, in one line: the sentence the card shows under its title,
 * and the sentence the Plugins page asks this entry for wherever the row needs
 * a description. A third-party patch row declares no description of its own,
 * so the page reaches for this entry's `view: 'summary'` and shows whatever it
 * returns — answering `null` here leaves the row's description empty.
 */
const WEB_FETCH_AUTH_ROW_SUMMARY =
  "Per-origin authenticated rules for web_fetch: credentials, SSRF policy, and diagnostics.";

interface RemoteService {
  status(): Promise<RemoteResult<ProviderStatusReport>>;
  testRule(ruleId: string, url?: string): Promise<RemoteResult<RuleTestReport>>;
  diagnose(url: string): Promise<RemoteResult<DiagnoseReport>>;
}

interface ClientRemote {
  $mount(contribution: TypertRemoteContribution): Promise<() => Promise<void>>;
  webFetchAuth: RemoteService;
  credentials: CredentialsRemote;
}

// The row page renders `plugins.row.config` with its own owner `form` seat,
// and the renderer spreads owner props after the injected face — so this
// card's full ConfigForm rides under `settingsForm`, a name the owner never
// occupies. The host seat is read but unused: the card keeps its own live
// store binding over the same namespace.
type CardProps = PropsRuntime<"plugins.row.config"> &
  InjectFace<Omit<CardFace, "form"> & { settingsForm: CardFace["form"] }>;

/** The card body takes the face alone; the owner's `view` stays with the entry. */
type CardBodyProps = Omit<CardProps, "view">;

function displayError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Could not load Authenticated Web Fetch data.";
}

function WebFetchAuthCard({
  settingsForm,
  status,
  testRule,
  diagnose,
  credentials,
}: CardBodyProps) {
  const settingsStore = useMemo(
    () => bindSettingsExternalStore(settingsForm),
    [settingsForm],
  );
  const settings = useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot,
    settingsStore.getSnapshot,
  );
  const config = settings.value;
  const writable = settings.status === "ready" && settings.writable;
  const [report, setReport] = useState<ProviderStatusReport | undefined>();
  const [error, setError] = useState<string | null>(null);
  const activeRequest = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++activeRequest.current;
    try {
      const result = await status();
      if (request !== activeRequest.current) return;
      if (result.ok) {
        setReport(result.value);
        setError(null);
      } else {
        setError(displayError(result.error));
      }
    } catch (cause) {
      if (request === activeRequest.current) setError(displayError(cause));
    }
  }, [status]);

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
        void settingsForm.set(field, value);
        return;
      }
      const current = settingsForm.getSnapshot().value;
      if (field === "audit") {
        void settingsForm.set(field, { ...current?.audit, [nested]: value });
      } else if (field === "limits") {
        void settingsForm.set(field, { ...current?.limits, [nested]: value });
      } else if (field === "defaultPolicy") {
        void settingsForm.set(field, {
          ...current?.defaultPolicy,
          [nested]: value,
        });
      }
    },
    [settingsForm],
  );

  const setRules = useCallback(
    (rules: AuthenticatedFetchRule[]) => {
      void settingsForm.set("rules", rules);
    },
    [settingsForm],
  );

  const warnings = useMemo(
    () => validateConfig(config ?? {}).warnings,
    [config],
  );

  if (settings.status === "unavailable") return null;

  // The row page renders the entry inside its own sections column, so the
  // list the shell's `<li>` root belongs to stays ours (AGENTS.md contract).
  return (
    <ul className="wfa-cards">
      <CardShell
        title="Authenticated Web Fetch"
        description={WEB_FETCH_AUTH_ROW_SUMMARY}
        badge={
          <span
            className="dsh-plugin-card__badge"
            data-testid="wfa-card-enabled-state"
          >
            {(config?.enabled ?? true) ? "Enabled" : "Disabled"}
          </span>
        }
        label={(open) =>
          `${open ? "Hide" : "Show"} settings: Authenticated Web Fetch`
        }
        bodyClassName="wfa-body"
      >
        {error !== null && (
          <div className="wfa-error" data-testid="wfa-card-error">
            {error}
          </div>
        )}
        <StatusSection status={report} warnings={warnings} />
        <RulesSection
          config={config}
          writable={writable}
          setRules={setRules}
          face={{
            form: settingsForm,
            status,
            testRule,
            diagnose,
            credentials,
          }}
        />
        <GlobalSection config={config} writable={writable} setPath={setPath} />
        <DiagnosticsSection diagnose={diagnose} />
      </CardShell>
    </ul>
  );
}

/**
 * The entry the row page seats for this bundle's own row, in one of two views:
 * `summary` is the row's description line, `page` the configuration body under
 * it. The summary answer returns before the card's hooks, so a line of text
 * never mounts a live settings store nor opens a second poll of the Remote.
 */
function WebFetchAuthEntry({ view, ...card }: CardProps) {
  if (view === "summary") return WEB_FETCH_AUTH_ROW_SUMMARY;
  return <WebFetchAuthCard {...card} />;
}

// `remote.credentials` is its own service key (owned by dsh-api-settings-controller),
// not a plain field of `remote`: reading it without this entry throws and the whole
// browser-side plugin fails to apply.
export const inject = ["slots", "configForms", "remote", "remote.credentials"];

/** Mount the generated Remote contribution and register the card on the plugin's row page of the Plugins panel. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const remote = (ctx as unknown as { remote: ClientRemote }).remote;
  const disposeRemote = await remote.$mount(webFetchAuthRemote);
  // The form and the slot belong to this plugin's own context; only the mounted
  // `remote.webFetchAuth` namespace is reached through a child scope, because
  // that key resolves once the Remote contribution is mounted.
  const form = ctx.configForms.get<WebFetchAuthConfig>(
    WEB_FETCH_AUTH_SETTINGS_NAMESPACE,
  );
  const removeStyles = injectCardStyles("dsh-web-fetch-authenticated", styles);
  try {
    await ctx.inject(["remote.webFetchAuth"], (remoteCtx) => {
      const injectedRemote = (remoteCtx as unknown as { remote: ClientRemote })
        .remote;
      const face: CardFace = {
        form,
        status: () => injectedRemote.webFetchAuth.status(),
        testRule: (ruleId, url) =>
          injectedRemote.webFetchAuth.testRule(ruleId, url),
        diagnose: (url) => injectedRemote.webFetchAuth.diagnose(url),
        credentials: injectedRemote.credentials,
      };
      // The owner `form` seat of this slot lands after the injected face, so
      // the card's ConfigForm crosses the boundary renamed (see CardProps).
      const { form: settingsForm, ...faceRest } = face;

      return ctx.slots.inject("plugins.row.config", () =>
        ctx.slots.register(
          {
            name: "plugins.row.config",
            key: WEB_FETCH_AUTH_ROW_CONFIG_KEY,
            inject: () => ({ ...faceRest, settingsForm }),
          },
          WebFetchAuthEntry,
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
