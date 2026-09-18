// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RemoteFailure } from "@deepseek-ai/dsh-typert-protocol";
import {
  createWeblateCard,
  type WeblateRemote,
} from "../src/client/weblate.js";
// The card renders whatever the host declares, so the fixture reuses the
// provider's own labels and the credential help it declares.
import { WEBLATE_CAPABILITY_INFO } from "../src/providers/weblate/catalog.js";
import { WEBLATE_CREDENTIAL_HELP } from "../src/providers/weblate/credential-help.js";
import type { IntegrationSummary } from "../src/types.js";

const HOSTED = {
  id: "hosted",
  label: "Hosted Weblate",
  baseUrl: "https://hosted.weblate.org",
  service: null,
};
const CORP = {
  id: "corp",
  label: "Corporate Weblate",
  baseUrl: "https://weblate.example.internal",
  service: null,
};
const INSTANCES = [HOSTED, CORP];

/** The host answers a refused call with a typed remote failure, not an Error. */
function failure(message: string): RemoteFailure {
  return { message } as unknown as RemoteFailure;
}

const disconnected: IntegrationSummary = {
  provider: "weblate",
  displayName: "Weblate",
  status: "not_connected",
  portal: null,
  externalAccountName: null,
  credentialConfigured: false,
  credentialUpdatedAt: null,
  capabilities: ["identity.read", "projects.read", "units.read"],
  capabilityInfo: WEBLATE_CAPABILITY_INFO,
  policy: [
    { capability: "identity.read", mode: "allow" },
    { capability: "projects.read", mode: "allow" },
    { capability: "units.read", mode: "allow" },
  ],
  lastValidatedAt: null,
  errorCode: null,
  credentialSource: "personal",
  service: null,
};

const connected: IntegrationSummary = {
  ...disconnected,
  status: "connected",
  portal: "https://hosted.weblate.org",
  externalAccountName: "Alice Example (@alice) · токен проекта",
  credentialConfigured: true,
  credentialUpdatedAt: "2026-09-16T06:00:00.000Z",
  lastValidatedAt: "2026-09-16T06:00:00.000Z",
};

function remote(overrides: Partial<WeblateRemote> = {}): WeblateRemote {
  return {
    weblateInstances: async () => ({ ok: true, value: INSTANCES }),
    getWeblate: async () => ({ ok: true, value: disconnected }),
    putWeblateCredential: async () => ({ ok: true, value: connected }),
    testWeblate: async () => ({ ok: true, value: connected }),
    patchWeblatePolicy: async () => ({ ok: true, value: connected }),
    disconnectWeblate: async () => ({ ok: true, value: true }),
    ...overrides,
  };
}

describe("Integrations Weblate card", () => {
  /**
   * The classes the shared skeleton and the plugin body rules define. A card
   * that invents one of its own would stop matching the other providers, which
   * is exactly the kind of drift the settings surface must not grow.
   */
  const SHARED_CLASSES = new Set([
    "dsh-qa-integrations__card",
    "dsh-qa-integrations__card-head",
    "dsh-qa-integrations__provider",
    "dsh-qa-integrations__portal",
    "dsh-qa-integrations__status",
    "dsh-qa-integrations__status--ok",
    "dsh-qa-integrations__section",
    "dsh-qa-integrations__field",
    "dsh-qa-integrations__input",
    "dsh-qa-integrations__hint",
    "dsh-qa-integrations__muted",
    "dsh-qa-integrations__permission",
    "dsh-qa-integrations__actions",
    "dsh-qa-integrations__button",
    "dsh-qa-integrations__button--primary",
    "dsh-qa-integrations__button--danger",
    "dsh-qa-integrations__notice",
    "dsh-qa-integrations__error",
  ]);

  it("wears the shared card shell and none of its own", async () => {
    const Card = createWeblateCard(
      remote({ getWeblate: async () => ({ ok: true, value: connected }) }),
    );
    const { container } = render(<Card token="qa-account-token" />);
    await screen.findByLabelText("Читать проекты");
    const used = new Set(
      [...container.querySelectorAll("[class]")].flatMap((node) =>
        String(node.getAttribute("class") ?? "").split(/\s+/u),
      ),
    );
    for (const className of used) {
      expect(SHARED_CLASSES.has(className), className).toBe(true);
    }
    // The root is the same article every provider card renders.
    expect(
      container.querySelector("article.dsh-qa-integrations__card"),
    ).not.toBeNull();
  });

  it("keeps the API token write-only and the instance a choice", async () => {
    const writes: { instanceId: string; token: string }[] = [];
    const Card = createWeblateCard(
      remote({
        putWeblateCredential: async (_token, input) => {
          writes.push(input);
          return { ok: true, value: connected };
        },
      }),
    );
    const { container } = render(<Card token="qa-account-token" />);
    const select = await screen.findByLabelText("Инстанс Weblate");
    expect(select).toHaveProperty("value", "");
    const input = screen.getByLabelText("API-токен Weblate");
    expect(input).toHaveProperty("type", "password");
    // The connect button stays locked until an instance is chosen.
    const connect = screen.getByRole("button", {
      name: "Сохранить и проверить",
    });
    expect(connect).toHaveProperty("disabled", true);
    fireEvent.change(select, { target: { value: "corp" } });
    const secret = "wlp_abcdefghijklmnopqrstuvwxyz0123456789";
    fireEvent.change(input, { target: { value: secret } });
    fireEvent.click(connect);
    await screen.findByText(/Alice Example/u);
    expect(writes).toEqual([{ instanceId: "corp", token: secret }]);
    await waitFor(() =>
      expect(screen.queryByLabelText("API-токен Weblate")).toBeNull(),
    );
    expect(container.textContent).not.toContain(secret);
    expect(container.textContent).not.toContain("Показать токен");
  });

  it("shows the single configured instance without asking for a choice", async () => {
    const writes: string[] = [];
    const Card = createWeblateCard(
      remote({
        weblateInstances: async () => ({ ok: true, value: [CORP] }),
        putWeblateCredential: async (_token, input) => {
          writes.push(input.instanceId);
          return { ok: true, value: connected };
        },
      }),
    );
    render(<Card token="qa-account-token" />);
    expect(await screen.findByText("Инстанс: Corporate Weblate")).toBeDefined();
    expect(screen.queryByLabelText("Инстанс Weblate")).toBeNull();
    fireEvent.change(screen.getByLabelText("API-токен Weblate"), {
      target: { value: "wlu_abcdefghijklmnopqrstuvwxyz0123456789" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Сохранить и проверить" }),
    );
    await waitFor(() => expect(writes).toEqual(["corp"]));
  });

  it("points the user at a project-scoped token without blocking", async () => {
    const Card = createWeblateCard(remote());
    const { container } = render(
      <Card token="qa-account-token" help={WEBLATE_CREDENTIAL_HELP} />,
    );
    const input = await screen.findByLabelText("API-токен Weblate");
    // The guidance lives in the help the Host declares, not in the card.
    fireEvent.click(
      screen.getByRole("button", { name: /Документация Weblate/u }),
    );
    expect(container.textContent).toContain("wlp_");
    expect(container.textContent).toContain("одному проекту");
    // Guidance, not a gate: a personal token is accepted like any other, and
    // the field is open as soon as the instance is chosen.
    fireEvent.change(screen.getByLabelText("Инстанс Weblate"), {
      target: { value: "corp" },
    });
    fireEvent.change(input, {
      target: { value: "wlu_abcdefghijklmnopqrstuvwxyz0123456789" },
    });
    expect(
      screen.getByRole("button", { name: "Сохранить и проверить" }),
    ).toHaveProperty("disabled", false);
  });

  it("shows no help at all when the deployment declares none", async () => {
    const Card = createWeblateCard(remote());
    render(<Card token="qa-account-token" />);
    await screen.findByLabelText("API-токен Weblate");
    expect(
      screen.queryByRole("button", { name: /Как это настроить/u }),
    ).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("keeps the capability rows honest and patchable", async () => {
    const patched: string[] = [];
    const Card = createWeblateCard(
      remote({
        getWeblate: async () => ({
          ok: true,
          value: {
            ...connected,
            capabilities: ["projects.read", "units.read"],
            policy: [
              { capability: "projects.read", mode: "allow" },
              { capability: "units.read", mode: "deny" },
            ],
          },
        }),
        patchWeblatePolicy: async (_token, patch) => {
          patched.push(`${patch.operation}:${patch.mode}`);
          return { ok: true, value: connected };
        },
      }),
    );
    const { container } = render(<Card token="qa-account-token" />);
    const projects = await screen.findByLabelText("Читать проекты");
    const units = screen.getByLabelText("Читать строки");
    const checks = screen.getByLabelText("Читать строки с ошибками проверок");
    expect(projects).toHaveProperty("checked", true);
    expect(units).toHaveProperty("checked", false);
    expect(units).toHaveProperty("disabled", false);
    // A capability the token does not grant is offered but locked.
    expect(checks).toHaveProperty("disabled", true);
    expect(container.textContent).toContain("Нет в правах токена");

    fireEvent.click(units);
    await waitFor(() => expect(patched).toEqual(["units.read:allow"]));
  });

  it("renders a policy failure instead of losing it", async () => {
    const Card = createWeblateCard(
      remote({
        getWeblate: async () => ({
          ok: false,
          error: failure("Integration request failed (reason: TlsFailure)"),
        }),
      }),
    );
    const { container } = render(<Card token="qa-account-token" />);
    await waitFor(() =>
      expect(container.textContent).toContain("Сертификат Weblate не принят"),
    );
  });

  it("asks for confirmation before dropping the stored token", async () => {
    let disconnectedCalls = 0;
    const Card = createWeblateCard(
      remote({
        getWeblate: async () => ({ ok: true, value: connected }),
        disconnectWeblate: async () => {
          disconnectedCalls += 1;
          return { ok: true, value: true };
        },
      }),
    );
    render(<Card token="qa-account-token" />);
    fireEvent.click(await screen.findByRole("button", { name: "Отключить" }));
    expect(disconnectedCalls).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Да, отключить" }));
    await waitFor(() => expect(disconnectedCalls).toBe(1));
  });

  it("tells the user when the operator configured no instance", async () => {
    let writes = 0;
    const Card = createWeblateCard(
      remote({
        weblateInstances: async () => ({ ok: true, value: [] }),
        putWeblateCredential: async () => {
          writes += 1;
          return { ok: true, value: connected };
        },
      }),
    );
    const { container } = render(<Card token="qa-account-token" />);
    await screen.findByText(/Оператор не настроил ни одного инстанса Weblate/u);
    expect(screen.queryByLabelText("API-токен Weblate")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Сохранить и проверить" }),
    ).toBeNull();
    expect(writes).toBe(0);
    expect(container.textContent).not.toContain("Показать токен");
  });
});
