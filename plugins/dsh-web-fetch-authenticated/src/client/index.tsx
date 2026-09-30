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

/**
 * The seat this bundle takes on the Host Plugins page. The page keys a row's
 * configuration by `` `${package name}#${row id}` `` and builds that key for the
 * row it is drawing (`@deepseek-ai/dsh-client-ui-plugin-manager` `0.1.7-rc.2`,
 * `lib/client.js:27`, used at `:1797`), and the row id is the settings namespace
 * the Host files this plugin's live Config under — one string, both roles,
 * declared by this package's `cordis.patch.yml` row. So a value saved before the
 * move is read back after it.
 */
const WEB_FETCH_AUTH_ROW_CONFIG_KEY = `@yadsh/dsh-web-fetch-authenticated#${WEB_FETCH_AUTH_SETTINGS_NAMESPACE}`;

/**
 * The row's description line. The page renders this entry's `summary` view into
 * the paragraph under the row heading, but only as the fallback for a
 * description the row's Host metadata does not carry
 * (`lib/client.js:1841`, `description ?? renderSlot("plugins.row.config",
 * { view: "summary" }, …)`, where `description` comes from `row.meta` at
 * `:214`). A third-party patch row declares no `row.meta.description`, so this
 * answer is the only sentence the row gets; answering `null` leaves it empty.
 */
const WEB_FETCH_AUTH_ROW_SUMMARY =
  "Per-origin authenticated rules for web_fetch: credentials, SSRF policy, and diagnostics.";

/**
 * What the card's own header promises to open. Deliberately not {@link
 * WEB_FETCH_AUTH_ROW_SUMMARY}: the page prints that sentence one line above this
 * card, so a header repeating it shows the same text twice.
 */
const WEB_FETCH_AUTH_CARD_DESCRIPTION =
  "Open the rule list, its write-only credential fields, the default policy and limits, and the diagnostic runner.";

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

/*
 * The page hands the `page` view an owner `form` of its own:
 * `formFor(row.rowId)` (`lib/client.js:2862`), which resolves the row id as the
 * settings namespace — the join that keeps a saved value readable after the move —
 * and returns `{ state, mutate }` for a namespace the page lists, or nothing at
 * all when it does not (`:2688-2694`). That is not the `ConfigForm` this card
 * binds, which needs `getSnapshot`/`set`/`subscribe`; so the card keeps its own
 * handle on the same document (`ctx.configForms.get(ns)`) and the renderer, which
 * spreads owner props after the injected face, carries it renamed to
 * `settingsForm` — a name the owner never occupies.
 *
 * Nothing the Host generates lands beside the card either: the configuration
 * column holds only this slot's return and the `plugins.detail.section` slot
 * (`:1852`). Whether the card should take the namespace away from the Host's
 * generated editor at all — `settings.configure({ auto: false })`, the lever
 * `dsh-documents` and `dsh-sleev` claim for cards that own their page — is the
 * parent card #646's call for the whole series, not this branch's.
 */
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

  // The page's configuration section supplies a plain `<div>` (`lib/client.js:1852`),
  // not a list, so the list the shell's `<li>` root belongs to stays ours
  // (AGENTS.md contract).
  return (
    <ul className="wfa-cards" data-testid="wfa-card-list">
      <CardShell
        title="Authenticated Web Fetch"
        description={WEB_FETCH_AUTH_CARD_DESCRIPTION}
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
 * The entry the page seats for this bundle's own row, in the two views it asks
 * for: `{ view: "summary" }` as the row's description line (`lib/client.js:1841`)
 * and `{ view: "page", form }` as the configuration body below it (`:1852`); the
 * contract shipped beside the bundle says the same in prose
 * (`lib/types/client/slot-contract.d.ts:12,110`). The summary answer returns
 * before the card's hooks, so a line of text never mounts a live settings store
 * nor opens a second poll of the Remote.
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
