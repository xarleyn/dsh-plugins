import type { QaUserSettingsSectionProps } from "@yadsh/dsh-qa-surface/client/settings";
import { createBitrix24Card, type IntegrationsRemote } from "./bitrix24.js";
import { createConfluenceCard, type ConfluenceRemote } from "./confluence.js";
import { createGitlabCard, type GitlabRemote } from "./gitlab.js";
import { createJiraCard, type JiraRemote } from "./jira.js";
import { createTeamcityCard, type TeamcityRemote } from "./teamcity.js";
import { createTestitCard, type TestitRemote } from "./testit.js";

export type IntegrationsClientRemote = IntegrationsRemote &
  ConfluenceRemote &
  GitlabRemote &
  TeamcityRemote &
  JiraRemote &
  TestitRemote;

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

/**
 * One card per provider the deployment mounted. The list comes from the host
 * (`describe`), so a provider the operator switched off simply never renders and
 * the client carries no knowledge of which exist.
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
  return function ProviderCards({ token, providers }: ProviderCardsProps) {
    return (
      <>
        {providers.includes("bitrix24") ? <Bitrix24Card token={token} /> : null}
        {providers.includes("confluence") ? (
          <ConfluenceCard token={token} />
        ) : null}
        {providers.includes("gitlab") ? <GitlabCard token={token} /> : null}
        {providers.includes("teamcity") ? <TeamcityCard token={token} /> : null}
        {providers.includes("jira") ? <JiraCard token={token} /> : null}
        {providers.includes("testit") ? <TestitCard token={token} /> : null}
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
