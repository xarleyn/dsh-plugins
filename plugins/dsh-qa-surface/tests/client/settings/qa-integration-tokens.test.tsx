// @vitest-environment jsdom

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QaIntegrationTokensPage } from "../../../src/client/user-settings/IntegrationTokensPage.js";
import { QaUserSettingsDialog } from "../../../src/client/user-settings/UserSettingsDialog.js";
import type { QaIntegrationTokenApi } from "../../../src/client/types.js";
import type {
  QaIssuedServiceToken,
  QaServiceTokenCreateInput,
  QaServiceTokenSummary,
} from "../../../src/types.js";

/**
 * The integration-token section of the profile dialog.
 *
 * What matters to a reader: the page says what the credential is for, the
 * secret is shown exactly once, and revoking asks twice because it cannot be
 * undone. The Host's own rules are covered by the store and remote tests; this
 * file only asserts what the person sees.
 */

function summary(
  overrides: Partial<QaServiceTokenSummary> = {},
): QaServiceTokenSummary {
  return {
    id: "token-1",
    label: "мост заявок",
    scopes: ["ask"],
    createdAt: "2026-09-21T10:00:00.000Z",
    expiresAt: "2026-12-20T10:00:00.000Z",
    lastUsedAt: null,
    revokedAt: null,
    useCount: 0,
    ...overrides,
  };
}

function issued(
  overrides: Partial<QaIssuedServiceToken> = {},
): QaIssuedServiceToken {
  return {
    ...summary(),
    token: "qsat.00000000-0000-4000-8000-000000000000.secret-value",
    ...overrides,
  };
}

function tokenApi(options: {
  readonly tokens?: readonly QaServiceTokenSummary[];
  readonly canCreate?: boolean;
  readonly listError?: string;
  readonly revokeError?: string;
  readonly createError?: string;
}): {
  readonly api: QaIntegrationTokenApi;
  readonly created: QaServiceTokenCreateInput[];
  readonly revoked: string[];
} {
  const created: QaServiceTokenCreateInput[] = [];
  const revoked: string[] = [];
  let tokens = options.tokens ?? [];
  const api: QaIntegrationTokenApi = {
    canCreate: options.canCreate ?? true,
    list: async () =>
      options.listError === undefined
        ? { ok: true, value: tokens }
        : { ok: false, error: options.listError },
    create: async (input) => {
      created.push(input);
      if (options.createError !== undefined) {
        return { ok: false, error: options.createError };
      }
      const minted = issued({
        label: input.label === "" ? "integration" : String(input.label),
      });
      tokens = [minted, ...tokens];
      return { ok: true, value: minted };
    },
    revoke: async (tokenId) => {
      revoked.push(tokenId);
      if (options.revokeError !== undefined) {
        return { ok: false, error: options.revokeError };
      }
      tokens = tokens.map((token) =>
        token.id === tokenId
          ? { ...token, revokedAt: "2026-09-21T11:00:00.000Z" }
          : token,
      );
      return { ok: true, value: null };
    },
  };
  return { api, created, revoked };
}

const writeText = vi.fn(async () => undefined);

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(window.navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  Object.defineProperty(window.navigator, "clipboard", {
    value: undefined,
    configurable: true,
  });
  Object.defineProperty(document, "execCommand", {
    value: undefined,
    configurable: true,
  });
});

describe("integration tokens page", () => {
  it("explains what the token is and starts from an empty list", async () => {
    const { api } = tokenApi({});
    render(<QaIntegrationTokensPage api={api} />);
    expect(screen.getByTestId("qa-settings-tokens-lead").textContent).toContain(
      "не открывая браузер",
    );
    expect(await screen.findByTestId("qa-settings-tokens-empty")).toBeTruthy();
  });

  it("shows the secret once and keeps it out of the list", async () => {
    const { api, created } = tokenApi({});
    render(<QaIntegrationTokensPage api={api} />);
    fireEvent.change(await screen.findByLabelText(/Название/u), {
      target: { value: "мост заявок" },
    });
    const mint = screen.getByTestId("qa-settings-tokens-create");
    expect(screen.getByRole("button", { name: "Создать токен" })).toBe(mint);
    fireEvent.click(mint);
    const secret = within(
      await screen.findByTestId("qa-settings-tokens-secret"),
    ).getByRole("textbox") as HTMLInputElement;
    expect(secret.value).toBe(
      "qsat.00000000-0000-4000-8000-000000000000.secret-value",
    );
    expect(secret.readOnly).toBe(true);
    expect(created).toEqual([
      { label: "мост заявок", scopes: ["ask"], ttlDays: 90 },
    ]);
    expect(
      screen.getByTestId("qa-settings-tokens-issued-notice").textContent,
    ).toContain("Показать его повторно нельзя");
    // The row that appears below carries no secret in any state.
    const meta = await screen.findByTestId("qa-settings-tokens-row-meta");
    expect(meta.textContent).toContain("использований: 0");
    expect(document.body.textContent).not.toContain("qsat.");
    fireEvent.click(screen.getByTestId("qa-settings-tokens-ack"));
    // Dismissing drops the one place the plaintext ever existed.
    expect(screen.queryByTestId("qa-settings-tokens-issued")).toBeNull();
    expect(screen.queryByTestId("qa-settings-tokens-secret")).toBeNull();
  });

  it("copies the secret on request", async () => {
    const { api } = tokenApi({});
    render(<QaIntegrationTokensPage api={api} />);
    fireEvent.click(screen.getByTestId("qa-settings-tokens-create"));
    const copy = await screen.findByTestId("qa-settings-tokens-copy");
    expect(screen.getByRole("button", { name: "Скопировать" })).toBe(copy);
    fireEvent.click(copy);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        "qsat.00000000-0000-4000-8000-000000000000.secret-value",
      );
    });
    expect(
      await screen.findByRole("button", { name: "Скопировано" }),
    ).toBeTruthy();
  });

  it("copies the secret through the copy command on an insecure page", async () => {
    Object.defineProperty(window.navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", {
      value: execCommand,
      configurable: true,
    });
    const { api } = tokenApi({});
    render(<QaIntegrationTokensPage api={api} />);
    fireEvent.click(screen.getByTestId("qa-settings-tokens-create"));
    const copy = await screen.findByTestId("qa-settings-tokens-copy");
    fireEvent.click(copy);
    await waitFor(() => expect(execCommand).toHaveBeenCalledWith("copy"));
    expect(
      await screen.findByRole("button", { name: "Скопировано" }),
    ).toBeTruthy();
  });

  it("says to copy by hand where no copy path exists", async () => {
    Object.defineProperty(window.navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    const { api } = tokenApi({});
    render(<QaIntegrationTokensPage api={api} />);
    fireEvent.click(screen.getByTestId("qa-settings-tokens-create"));
    const hint = await screen.findByTestId("qa-settings-tokens-copy-hint");
    expect(hint.textContent).toBe("Скопируйте вручную");
    expect(screen.queryByTestId("qa-settings-tokens-copy")).toBeNull();
  });

  it("asks twice before revoking, and reports the state it leaves behind", async () => {
    const { api, revoked } = tokenApi({ tokens: [summary()] });
    render(<QaIntegrationTokensPage api={api} />);
    fireEvent.click(await screen.findByTestId("qa-settings-tokens-revoke"));
    expect(revoked).toEqual([]);
    fireEvent.click(screen.getByTestId("qa-settings-tokens-revoke-cancel"));
    expect(
      screen.queryByTestId("qa-settings-tokens-revoke-confirm"),
    ).toBeNull();
    expect(revoked).toEqual([]);
    fireEvent.click(screen.getByTestId("qa-settings-tokens-revoke"));
    fireEvent.click(screen.getByTestId("qa-settings-tokens-revoke-confirm"));
    await waitFor(() => {
      expect(revoked).toEqual(["token-1"]);
    });
    // A revoked token stays in the list as a record, with no revoke button.
    expect(screen.getByTestId("qa-settings-tokens-row-state").textContent).toBe(
      "отозван",
    );
    expect(screen.queryByRole("button", { name: "Отозвать" })).toBeNull();
  });

  it("marks an expired token and offers no revoke for it", async () => {
    const { api } = tokenApi({
      tokens: [summary({ expiresAt: "2020-01-01T00:00:00.000Z" })],
    });
    render(<QaIntegrationTokensPage api={api} />);
    await waitFor(() =>
      expect(
        screen.getByTestId("qa-settings-tokens-row-state").textContent,
      ).toContain("истёк"),
    );
    expect(screen.queryByRole("button", { name: "Отозвать" })).toBeNull();
  });

  it("explains the off state instead of offering a button that only refuses", async () => {
    const { api } = tokenApi({
      canCreate: false,
      tokens: [summary()],
    });
    render(<QaIntegrationTokensPage api={api} />);
    expect(
      screen.getByTestId("qa-settings-tokens-api-off").textContent,
    ).toContain("Интеграционный API выключен");
    expect(screen.queryByRole("button", { name: "Создать токен" })).toBeNull();
    // A credential that already exists has to stay revocable.
    expect(
      await screen.findByRole("button", { name: "Отозвать" }),
    ).toBeTruthy();
  });

  it("keeps the page and shows the refusal copy", async () => {
    const { api, revoked } = tokenApi({
      tokens: [summary()],
      revokeError:
        "Этот токен принадлежит другой учётной записи или уже удалён.",
    });
    render(<QaIntegrationTokensPage api={api} />);
    fireEvent.click(await screen.findByTestId("qa-settings-tokens-revoke"));
    fireEvent.click(screen.getByTestId("qa-settings-tokens-revoke-confirm"));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "принадлежит другой учётной записи",
    );
    expect(revoked).toEqual(["token-1"]);
  });

  it("shows a failed read as copy rather than an empty list", async () => {
    const { api } = tokenApi({
      listError: "Не удалось войти. Попробуйте ещё раз.",
    });
    render(<QaIntegrationTokensPage api={api} />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Не удалось войти",
    );
  });
});

describe("integration tokens dialog section", () => {
  it("appears as a section of the settings dialog and hides when withheld", async () => {
    const { api } = tokenApi({ tokens: [summary()] });
    const { unmount } = render(
      <QaUserSettingsDialog
        open
        initialSection="tokens"
        email="i.ivanov@example.com"
        role="user"
        chatCount={1}
        onClose={vi.fn()}
        integrationTokens={api}
      />,
    );
    expect(
      screen.getByRole("tab", { name: "Интеграционные токены" }),
    ).toBeTruthy();
    expect(
      (await screen.findByTestId("qa-settings-tokens-row-title")).textContent,
    ).toBe("мост заявок");
    unmount();
    render(
      <QaUserSettingsDialog
        open
        initialSection="general"
        email="i.ivanov@example.com"
        role="user"
        chatCount={1}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("tab", { name: "Интеграционные токены" }),
    ).toBeNull();
  });
});
