import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { CredentialHelp } from "@yadsh/dsh-plugin-kit";
import type { QaUserSettingsSectionProps } from "@yadsh/dsh-qa-surface/client/settings";
import { useEffect, useRef, useState } from "react";
import type { IntegrationProviderSummary } from "../types.js";
import {
  createBitrix24Card,
  type Bitrix24Remote,
  type IntegrationsRemote,
} from "./bitrix24.js";
import { createConfluenceCard, type ConfluenceRemote } from "./confluence.js";
import { createGitlabCard, type GitlabRemote } from "./gitlab.js";
import { createJiraCard, type JiraRemote } from "./jira.js";
import { createTeamcityCard, type TeamcityRemote } from "./teamcity.js";
import { createTestitCard, type TestitRemote } from "./testit.js";
import { createWeblateCard, type WeblateRemote } from "./weblate.js";

/** The provider list arrives with each provider's credential help on it. */
export interface CredentialHelpRemote {
  providers(
    token: string,
  ): Promise<RemoteResult<readonly IntegrationProviderSummary[]>>;
}

export type IntegrationsClientRemote = CredentialHelpRemote &
  IntegrationsRemote &
  Bitrix24Remote &
  ConfluenceRemote &
  GitlabRemote &
  TeamcityRemote &
  JiraRemote &
  TestitRemote &
  WeblateRemote;

/** What every mount of the provider cards needs. */
export interface ProviderCardsProps {
  /** Current QA account token; transport authentication for the remotes. */
  readonly token: string;
  /** Provider ids the Host declared, in mount order. */
  readonly providers: readonly string[];
}

/** The disclosure that has to stand next to the credentials. */
export const INTEGRATIONS_DISCLOSURE =
  "Данные, которые агент читает через интеграцию, могут передаваться настроенному для этого чата LLM-провайдеру для выполнения запроса. Секрет подключения в модель не передаётся.";

/** Credential help per provider id; empty until the Host answers. */
type CredentialHelpMap = ReadonlyMap<string, CredentialHelp | null>;

/** What one read of the deployment tells the page. */
interface DeploymentProviders {
  /** Credential help per provider id; empty until the answer arrives. */
  readonly helps: CredentialHelpMap;
  /** The providers the service offers, or undefined while unknown. */
  readonly offered: readonly string[] | undefined;
}

/**
 * Read the deployment once per mount: the provider cards and the credential
 * help each one shows. Both are a display-only payload: when the call fails, or
 * a provider declares no help, the cards render their plain credential fields —
 * which is why nothing here may block the form.
 */
function useDeploymentProviders(
  remote: CredentialHelpRemote,
  token: string,
): DeploymentProviders {
  const [state, setState] = useState<DeploymentProviders>(() => ({
    helps: new Map(),
    offered: undefined,
  }));
  // The remote proxy keeps one identity in practice, but the token is what
  // decides when to read, so the call goes through a ref and stays the only
  // dependency of the effect.
  const remoteRef = useRef(remote);
  remoteRef.current = remote;
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await remoteRef.current.providers(token);
      if (cancelled || !result.ok) return;
      setState({
        helps: new Map(
          result.value.map((provider) => [
            provider.id,
            provider.credentialHelp,
          ]),
        ),
        offered: result.value.map((provider) => provider.id),
      });
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token]);
  return state;
}

/**
 * One card per provider the deployment mounted. The starting list comes from the
 * host (`describe`), and each mount re-reads what the service offers, so a
 * provider the operator switched off stops rendering and the client carries no
 * knowledge of which exist. The credential help each card shows comes from the
 * same host, per provider.
 *
 * Both mounts share this component: the page of the QA settings dialog, where
 * the account gate lives, and the host's plugin-configuration card.
 */
export function createProviderCards(remote: IntegrationsClientRemote) {
  const Bitrix24Card = createBitrix24Card(remote);
  const ConfluenceCard = createConfluenceCard(remote);
  const GitlabCard = createGitlabCard(remote);
  const TeamcityCard = createTeamcityCard(remote);
  const JiraCard = createJiraCard(remote);
  const TestitCard = createTestitCard(remote);
  const WeblateCard = createWeblateCard(remote);
  return function ProviderCards({ token, providers }: ProviderCardsProps) {
    const { helps, offered } = useDeploymentProviders(remote, token);
    const helpFor = (id: string) => helps.get(id) ?? null;
    // The list below is what the page was built from; `offered` is what the
    // service still has. A provider the operator switches off stops rendering
    // without waiting for the page to reload, and a read that has not answered
    // keeps every card rather than blanking the forms.
    const shown = (id: string): boolean =>
      providers.includes(id) && (offered === undefined || offered.includes(id));
    return (
      <>
        {shown("bitrix24") ? (
          <Bitrix24Card token={token} help={helpFor("bitrix24")} />
        ) : null}
        {shown("confluence") ? (
          <ConfluenceCard token={token} help={helpFor("confluence")} />
        ) : null}
        {shown("gitlab") ? (
          <GitlabCard token={token} help={helpFor("gitlab")} />
        ) : null}
        {shown("teamcity") ? (
          <TeamcityCard token={token} help={helpFor("teamcity")} />
        ) : null}
        {shown("jira") ? (
          <JiraCard token={token} help={helpFor("jira")} />
        ) : null}
        {shown("testit") ? (
          <TestitCard token={token} help={helpFor("testit")} />
        ) : null}
        {shown("weblate") ? (
          <WeblateCard token={token} help={helpFor("weblate")} />
        ) : null}
      </>
    );
  };
}

/** The `Интеграции` page of the signed-in user's QA settings dialog. */
export function createIntegrationsPage(
  remote: IntegrationsClientRemote,
  providers: readonly string[],
) {
  const ProviderCards = createProviderCards(remote);
  return function IntegrationsPage({ token }: QaUserSettingsSectionProps) {
    return (
      <section
        className="dsh-qa-integrations"
        data-testid="qa-integrations-page"
        aria-labelledby="qa-integrations-title"
      >
        <div>
          <h2
            id="qa-integrations-title"
            className="dsh-qa-integrations__heading"
            data-testid="qa-integrations-page-title"
          >
            Интеграции
          </h2>
          <p
            className="dsh-qa-integrations__lead"
            data-testid="qa-integrations-page-lead"
          >
            Подключите свои рабочие сервисы. Каждое подключение доступно только
            вашему аккаунту.
          </p>
        </div>
        <ProviderCards token={token} providers={providers} />
        <p
          className="dsh-qa-integrations__notice"
          data-testid="qa-integrations-page-disclosure"
        >
          {INTEGRATIONS_DISCLOSURE}
        </p>
      </section>
    );
  };
}
