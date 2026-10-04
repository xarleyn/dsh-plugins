import type {
  QaUserSession,
  QaUserSessionSnapshot,
} from "@yadsh/dsh-qa-surface/client/settings";
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
 * The Integrations section shown on this bundle's page on the Plugins surface.
 *
 * A connection belongs to a QA account, and the token of that account is the
 * only credential the principal-scoped remotes accept, so the section renders the
 * provider cards only once the QA session service reports a signed-in account —
 * and says so instead of showing forms that could only fail.
 *
 * The body is all this draws. The page supplies the card surface, the package
 * title and the `data-plugin-config` section this lands in, so the frame, the
 * expand control and the shell classes are the Host's (AGENTS.md, "Two kinds of
 * card: who owns the chrome"). The one heading is the section's own name, and it
 * is not a second heading: the Host's bundle page wraps this seat in a section
 * that carries no title element, while the rows section beside it titles itself —
 * `tests/client/host-seat-contract.test.ts` reads both halves out of the installed
 * page and fails if the untitled section ever gains one. It is an `<h4>` for the
 * same reason: on that page the package name is an `<h3>` and the section beside
 * this one is an `<h4>`, so a section heading of ours takes the section level.
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
      <div
        className="dsh-qa-integrations__body"
        data-testid="qa-integrations-bundle-card"
      >
        <h4 className="dsh-qa-integrations__body-title">Интеграции</h4>
        <p className="dsh-qa-integrations__lead">
          Свои рабочие сервисы: подключения принадлежат вашему аккаунту QA.
        </p>
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
      </div>
    );
  };
}
