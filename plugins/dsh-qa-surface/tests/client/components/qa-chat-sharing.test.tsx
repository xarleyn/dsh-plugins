// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QaChatSharing } from "../../../src/client/components/QaChatSharing.js";
import type { QaChatAccess } from "../../../src/chat-sharing/types.js";
const owner: QaChatAccess = {
  sessionId: "demo-chat",
  ownerId: "owner",
  ownerName: "Demo Owner",
  actorId: "owner",
  mode: "owner",
  revision: 0,
};
afterEach(cleanup);
describe("account-specific chat sharing UI", () => {
  it("grants, changes and revokes one named account and preserves the credentials explanation", async () => {
    const grant = {
      userId: "reader",
      email: "reader@example.com",
      displayName: "Demo Reader",
      mode: "read" as const,
    };
    const api = {
      access: vi.fn(),
      visible: vi.fn(),
      grants: vi.fn(async () => ({ ok: true as const, value: [] })),
      set: vi.fn(
        async (
          _token: string,
          _id: string,
          _email: string,
          mode: "read" | "collaborate" | null,
        ) => ({
          ok: true as const,
          value: mode === null ? [] : [{ ...grant, mode }],
        }),
      ),
    };
    render(<QaChatSharing access={owner} token="synthetic-token" api={api} />);
    fireEvent.click(screen.getByRole("button", { name: "Поделиться чатом" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Адрес аккаунта")).not.toHaveProperty(
        "disabled",
        true,
      ),
    );
    expect(screen.getByText(/модель и учётные данные владельца/u)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Адрес аккаунта"), {
      target: { value: grant.email },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Предоставить доступ" }),
    );
    await screen.findByText(grant.email);
    expect(api.set).toHaveBeenLastCalledWith(
      "synthetic-token",
      "demo-chat",
      grant.email,
      "read",
    );
    fireEvent.change(screen.getByLabelText("Режим доступа: Demo Reader"), {
      target: { value: "collaborate" },
    });
    await waitFor(() =>
      expect(api.set).toHaveBeenLastCalledWith(
        "synthetic-token",
        "demo-chat",
        grant.email,
        "collaborate",
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Отозвать доступ" }),
      ).not.toHaveProperty("disabled", true),
    );
    fireEvent.click(screen.getByRole("button", { name: "Отозвать доступ" }));
    await waitFor(() =>
      expect(api.set).toHaveBeenLastCalledWith(
        "synthetic-token",
        "demo-chat",
        grant.email,
        null,
      ),
    );
  });
  it.each(["read", "collaborate"] as const)(
    "shows %s and owner without access-management controls",
    (mode) => {
      render(
        <QaChatSharing
          access={{ ...owner, actorId: "recipient", mode, revision: 1 }}
          token="synthetic-token"
          api={{
            access: vi.fn(),
            visible: vi.fn(),
            grants: vi.fn(),
            set: vi.fn(),
          }}
        />,
      );
      expect(
        screen.queryByRole("button", { name: "Поделиться чатом" }),
      ).toBeNull();
      expect(screen.getByText(/Demo Owner/u)).toBeTruthy();
    },
  );
});
