import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { CredentialHelp } from "@yadsh/dsh-plugin-kit";
import type { QaUserSettingsSectionProps } from "@yadsh/dsh-qa-surface/client/settings";
import { useEffect, useRef, useState } from "react";
import type { IntegrationProviderSummary } from "../types.js";
import { createBitrix24Card, type IntegrationsRemote } from "./bitrix24.js";
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

/**
 * Read the credential help once per mount. It is a display-only payload: when
 * the call fails, or a provider declares none, the cards render their plain
 * credential fields — which is why nothing here may block the form.
 */
function useCredentialHelp(
  remote: CredentialHelpRemote,
  token: string,
): CredentialHelpMap {
  const [helps, setHelps] = useState<CredentialHelpMap>(() => new Map());
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
      setHelps(
        new Map(
          result.value.map((provider) => [
            provider.id,
            provider.credentialHelp,
          ]),
        ),
      );
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token]);
  return helps;
}

/**
 * One card per provider the deployment mounted. The list comes from the host
 * (`describe`), so a provider the operator switched off simply never renders and
 * the client carries no knowledge of which exist. The credential help each card
 * shows comes from the same host, per provider.
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
    const help = useCredentialHelp(remote, token);
    const helpFor = (id: string) => help.get(id) ?? null;
    return (
      <>
        {providers.includes("bitrix24") ? (
          <Bitrix24Card token={token} help={helpFor("bitrix24")} />
        ) : null}
        {providers.includes("confluence") ? (
          <ConfluenceCard token={token} help={helpFor("confluence")} />
        ) : null}
        {providers.includes("gitlab") ? (
          <GitlabCard token={token} help={helpFor("gitlab")} />
        ) : null}
        {providers.includes("teamcity") ? (
          <TeamcityCard token={token} help={helpFor("teamcity")} />
        ) : null}
        {providers.includes("jira") ? (
          <JiraCard token={token} help={helpFor("jira")} />
        ) : null}
        {providers.includes("testit") ? (
          <TestitCard token={token} help={helpFor("testit")} />
        ) : null}
        {providers.includes("weblate") ? (
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
        aria-labelledby="qa-integrations-title"
      >
        <div>
          <h2
            id="qa-integrations-title"
            className="dsh-qa-integrations__heading"
          >
            Интеграции
          </h2>
          <p className="dsh-qa-integrations__lead">
            Подключите свои рабочие сервисы. Каждое подключение доступно только
            вашему аккаунту.
          </p>
        </div>
        <ProviderCards token={token} providers={providers} />
        <p className="dsh-qa-integrations__notice">{INTEGRATIONS_DISCLOSURE}</p>
      </section>
    );
  };
}
