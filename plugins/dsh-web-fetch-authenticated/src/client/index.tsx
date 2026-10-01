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
 * configuration by `` `${package name}#${row id}` `` (`config-ledger.ts:36`,
 * `rowConfigKey`) and looks that key up for the row it is drawing and for the
 * **Configure** control on the bundle's page (`PluginManagerPage.tsx:473`,
 * `:1191`), where the control exists only for a key somebody registered. The row
 * id is the settings namespace the Host files this plugin's live Config under —
 * one string, both roles, declared by this package's `cordis.patch.yml` row. So
 * a value saved before the move is read back after it, and this row gained its
 * way into its configuration with the seat.
 */
const WEB_FETCH_AUTH_ROW_CONFIG_KEY = `@yadsh/dsh-web-fetch-authenticated#${WEB_FETCH_AUTH_SETTINGS_NAMESPACE}`;

/**
 * The row's description line, as this entry answers it. The page renders the
 * `summary` view only as the fallback for a description the row's Host metadata
 * does not carry (`PluginManagerPage.tsx:491`, `description ?? renderSlot(…)`,
 * with `description` read off `row.meta` in `presentation.ts:131`), and this
 * row's metadata is never empty: the Host builds it from the row's own manifest
 * (`@deepseek-ai/dsh-plugin-manager` `0.1.7-rc.2` `src/index.ts:650`, through
 * `@deepseek-ai/dsh-app-boot` `src/package-meta.ts:157`, where a missing field
 * falls back to that manifest's `description`). So the sentence printed above
 * this card today is this package's `description`, and this answer is what the
 * row would say if that field were dropped.
 *
 * It stays answered because the seat contract asks both views of every
 * registrant (`slot-contract.ts`), and because the answer is a string: the page
 * drops it into a paragraph of its own, so markup here would nest a card inside
 * a sentence.
 */
const WEB_FETCH_AUTH_ROW_SUMMARY =
  "Per-origin authenticated rules for web_fetch: credentials, SSRF policy, and diagnostics.";

/**
 * What the card's own header promises to open. Deliberately not {@link
 * WEB_FETCH_AUTH_ROW_SUMMARY}, and deliberately not this package's
 * `description` field either: the page prints one of those two as the row's
 * line one paragraph above the card, so a header repeating it shows the same
 * text twice.
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
 * `formFor(row.rowId)` (`PluginManagerPage.tsx:1151`, handed to the row page at
 * `:1282`), which resolves the row id as the settings namespace — the join that
 * keeps a saved value readable after the move — and returns `{ state, mutate }`
 * for a namespace the page lists, or nothing at all when it does not. That is
 * not the `ConfigForm` this card binds, which needs `getSnapshot`/`set`/
 * `subscribe`; so the card keeps its own handle on the same document
 * (`ctx.configForms.get(ns)`) and the renderer, which spreads owner props after
 * the injected face, carries it renamed to `settingsForm` — a name the owner
 * never occupies. The entry takes the owner `form` off the props on the way in,
 * so the body holds one form rather than two names for the same namespace, one
 * of which cannot write a single field.
 *
 * Nothing the Host generates lands beside the card either: the configuration
 * column holds only this slot's return and the `plugins.detail.section` slot
 * (`:494-496`). Whether the card should take the namespace away from the Host's
 * generated editor at all — `settings.configure({ auto: false })`, the lever
 * `dsh-documents` and `dsh-sleev` claim for cards that own their page — is the
 * parent card #646's call for the whole series, not this branch's.
 */
type CardProps = PropsRuntime<"plugins.row.config"> &
  InjectFace<Omit<CardFace, "form"> & { settingsForm: CardFace["form"] }>;

/**
 * The card body takes the face alone: the entry's `view` decides what the seat
 * draws, and the page's `form` is the same namespace through a view that can
 * neither be subscribed to nor written field by field.
 */
type CardBodyProps = Omit<CardProps, "view" | "form">;

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

  // The page's configuration section is a plain `<div>`
  // (`PluginManagerPage.tsx:494`, `detailSections`), not a list, so the list the
  // shell's `<li>` root belongs to stays ours (AGENTS.md contract).
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
 * The entry the page seats for this bundle's own row, in the two views its seat
 * contract asks for: `{ view: "summary" }` as a row's one-liner and
 * `{ view: "page", form }` as the configuration body (`PluginManagerPage.tsx:491`,
 * `:495`; `slot-contract.ts` says an entry answers both). For this row the page
 * already holds a description read from the package manifest, so the summary
 * answer is the fallback rather than the visible line — see {@link
 * WEB_FETCH_AUTH_ROW_SUMMARY}. The summary returns before the card's hooks, so a
 * line of text never mounts a live settings store nor opens a second poll of the
 * Remote, and the owner `form` stops here: the body writes through the face's
 * `settingsForm` alone.
 */
function WebFetchAuthEntry({ view, form: _pageForm, ...card }: CardProps) {
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
