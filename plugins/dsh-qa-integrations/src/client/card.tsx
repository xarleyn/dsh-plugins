import type {
  QaUserSession,
  QaUserSessionSnapshot,
} from "@yadsh/dsh-qa-surface/client/settings";
import { CardShell } from "@yadsh/dsh-plugin-kit/client";
import { useSyncExternalStore, type ReactElement } from "react";
import {
  createProviderCards,
  INTEGRATIONS_DISCLOSURE,
  type IntegrationsClientRemote,
} from "./integrations.js";

/** What the card shows while no QA account is signed in. */
function gateCopy(stage: QaUserSessionSnapshot["stage"]): string {
  switch (stage) {
    case "checking":
      return "Проверяем вход в QA Surface…";
    case "anonymous":
      return "Войдите в QA Surface, чтобы подключать свои сервисы: подключение принадлежит вашему аккаунту, а не стенду.";
    default:
      return "";
  }
}

/**
 * The Integrations card shown on this bundle's page on the Plugins surface.
 *
 * A connection belongs to a QA account, and the token of that account is the
 * only credential the principal-scoped remotes accept, so the card renders the
 * provider cards only once the QA session service reports a signed-in account —
 * and says so instead of showing forms that could only fail.
 */
export function createIntegrationsCard(
  remote: IntegrationsClientRemote,
  providers: readonly string[],
  session: QaUserSession,
) {
  const ProviderCards = createProviderCards(remote);
  return function IntegrationsCard(): ReactElement {
    const snapshot = useSyncExternalStore(
      session.subscribe,
      session.getSnapshot,
      session.getSnapshot,
    );
    return (
      <CardShell
        title="Интеграции"
        description="Свои рабочие сервисы: подключения принадлежат вашему аккаунту QA."
        label={(open) =>
          open
            ? "Свернуть настройки интеграций"
            : "Развернуть настройки интеграций"
        }
        bodyClassName="dsh-qa-integrations__body"
      >
        {snapshot.stage === "authed" ? (
          <>
            <ProviderCards token={snapshot.token} providers={providers} />
            <p
              className="dsh-qa-integrations__notice"
              data-testid="qa-integrations-settings-card-disclosure"
            >
              {INTEGRATIONS_DISCLOSURE}
            </p>
          </>
        ) : (
          <p
            className="dsh-qa-integrations__hint"
            data-testid="qa-integrations-settings-card-gate"
          >
            {gateCopy(snapshot.stage)}
          </p>
        )}
      </CardShell>
    );
  };
}

/**
 * The wrapper the bundle's configuration section renders: the page hands that
 * section an empty column, so the card shell's `<li>` keeps a list this plugin
 * owns.
 */
export function createIntegrationsBundleCard(
  remote: IntegrationsClientRemote,
  providers: readonly string[],
  session: QaUserSession,
) {
  const IntegrationsCard = createIntegrationsCard(remote, providers, session);
  return function IntegrationsBundleCard(): ReactElement {
    return (
      <ul
        className="dsh-qa-integrations__host-tab"
        data-testid="qa-integrations-host-tab"
      >
        <IntegrationsCard />
      </ul>
    );
  };
}
