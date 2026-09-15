import type { QaUserSettingsSectionProps } from "@yadsh/dsh-qa-surface/client/settings";
import { createBitrix24Card, type IntegrationsRemote } from "./bitrix24.js";
import { createGitlabCard, type GitlabRemote } from "./gitlab.js";

export type IntegrationsClientRemote = IntegrationsRemote & GitlabRemote;

/**
 * One settings section, one card per provider the deployment mounted. The card
 * list comes from the host (`describe`), so a provider the operator switched off
 * simply never renders and the client carries no knowledge of which exist.
 */
export function createIntegrationsPage(
  remote: IntegrationsClientRemote,
  providers: readonly string[],
) {
  const Bitrix24Card = createBitrix24Card(remote);
  const GitlabCard = createGitlabCard(remote);
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
        {providers.includes("bitrix24") ? <Bitrix24Card token={token} /> : null}
        {providers.includes("gitlab") ? <GitlabCard token={token} /> : null}
        <p className="dsh-qa-integrations__notice">
          Данные, которые агент читает через интеграцию, могут передаваться
          настроенному для этого чата LLM-провайдеру для выполнения запроса.
          Секрет подключения в модель не передаётся.
        </p>
      </section>
    );
  };
}
