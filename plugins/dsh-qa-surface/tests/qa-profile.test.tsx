// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QaProfileModal } from "../src/client/components/QaProfile.js";
import { QaSidebar } from "../src/client/components/QaSidebar.js";
import type { QaAccountIdentityField, QaAccountProfile } from "../src/types.js";

const FIELDS: readonly QaAccountIdentityField[] = [
  { key: "jira", label: "Jira" },
  { key: "gitlab", label: "GitLab" },
];

function profile(overrides: Partial<QaAccountProfile> = {}): QaAccountProfile {
  return {
    fullName: "",
    identities: {},
    instructions: "",
    updatedAt: null,
    ...overrides,
  };
}

function modal(props: {
  readonly profile?: QaAccountProfile;
  readonly identities?: readonly QaAccountIdentityField[];
  readonly instructionsMaxLength?: number;
  readonly onSave?: (input: unknown) => Promise<string | null>;
  readonly onClose?: () => void;
}) {
  return render(
    <QaProfileModal
      open
      email="i.ivanov@example.com"
      profile={props.profile ?? profile()}
      identities={props.identities ?? FIELDS}
      instructionsMaxLength={props.instructionsMaxLength ?? 2_000}
      onClose={props.onClose ?? vi.fn()}
      onSave={(props.onSave ?? vi.fn(async () => null)) as never}
    />,
  );
}

describe("QA profile dialog", () => {
  it("seeds one field per declared handle plus the free-text areas", () => {
    modal({
      profile: profile({
        fullName: "Иван Иванов",
        identities: { jira: "i.ivanov" },
        instructions: "Отвечай кратко.",
      }),
    });
    expect(screen.getByText("Профиль")).toBeTruthy();
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(
      "i.ivanov@example.com",
    );
    expect((screen.getByLabelText("ФИО") as HTMLInputElement).value).toBe(
      "Иван Иванов",
    );
    expect((screen.getByLabelText("Jira") as HTMLInputElement).value).toBe(
      "i.ivanov",
    );
    expect((screen.getByLabelText("GitLab") as HTMLInputElement).value).toBe(
      "",
    );
    expect(
      (
        screen.getByLabelText(
          "Общие инструкции для агента",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("Отвечай кратко.");
    // The email is the account's, not something this dialog can change.
    expect((screen.getByLabelText("Email") as HTMLInputElement).readOnly).toBe(
      true,
    );
  });

  it("sends only the declared handles and closes once stored", async () => {
    const onSave = vi.fn(async () => null);
    const onClose = vi.fn();
    modal({
      profile: profile({ identities: { jira: "i.ivanov", stale: "old" } }),
      onSave,
      onClose,
    });
    fireEvent.change(screen.getByLabelText("ФИО"), {
      target: { value: "Иван Иванов" },
    });
    fireEvent.change(screen.getByLabelText("GitLab"), {
      target: { value: "@iivanov" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        fullName: "Иван Иванов",
        identities: { jira: "i.ivanov", gitlab: "@iivanov" },
        instructions: "",
      });
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("keeps the dialog open and shows the refusal copy", async () => {
    const onClose = vi.fn();
    modal({ onSave: async () => "Проверьте поля профиля.", onClose });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Проверьте поля профиля.",
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("blocks saving text past the deployment's limits", () => {
    modal({ instructionsMaxLength: 10 });
    const save = screen.getByRole("button", {
      name: "Сохранить",
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Общие инструкции для агента"), {
      target: { value: "я".repeat(11) },
    });
    expect(
      (
        screen.getByRole("button", {
          name: "Сохранить",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByText("11 / 10")).toBeTruthy();
  });

  it("says when no external systems are configured", () => {
    modal({ identities: [] });
    expect(screen.queryByLabelText("Jira")).toBeNull();
    expect(screen.getByText(/Внешние системы/u)).toBeTruthy();
  });

  it("asks for the wider panel its hint sentences need", () => {
    const { container } = modal({});
    // The shared shell's width wraps these full sentences mid-line and leaves
    // a single word on the second line.
    expect(container.querySelector(".dsh-qa-modal__panel--wide")).toBeTruthy();
  });

  it("closes on Escape and on a backdrop click", () => {
    const onClose = vi.fn();
    const { container } = render(
      <QaProfileModal
        open
        email="i.ivanov@example.com"
        profile={profile()}
        identities={FIELDS}
        instructionsMaxLength={2_000}
        onClose={onClose}
        onSave={async () => null}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector(".dsh-qa-modal") as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("QA sidebar profile entry point", () => {
  const base = {
    rows: [],
    title: "DeepSeek QA",
    logoUrl: null,
    stateKey: "dsh-qa-surface.session:v1:/qa",
    showNewChat: false,
    busy: false,
    onSwitch: vi.fn(),
    onNewChat: vi.fn(),
  };

  it("opens the dialog from the account name and shows the stored full name", () => {
    render(
      <QaSidebar
        {...base}
        account={{
          email: "i.ivanov@example.com",
          role: "admin",
          onLogout: vi.fn(),
          profileDialog: {
            profile: profile({ fullName: "Иван Иванов" }),
            fields: FIELDS,
            instructionsMaxLength: 2_000,
            onSave: async () => null,
          },
        }}
      />,
    );
    expect(screen.getByText("Иван Иванов")).toBeTruthy();
    fireEvent.click(screen.getByTitle("Открыть профиль"));
    expect(document.querySelector(".dsh-qa-modal")).toBeTruthy();
    expect(screen.getByLabelText("Jira")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Закрыть профиль"));
    expect(document.querySelector(".dsh-qa-modal")).toBeNull();
  });

  it("falls back to the email and stays plain text without profiles", () => {
    const { rerender } = render(
      <QaSidebar
        {...base}
        account={{
          email: "i.ivanov@example.com",
          role: "user",
          onLogout: vi.fn(),
          profileDialog: {
            profile: profile(),
            fields: FIELDS,
            instructionsMaxLength: 2_000,
            onSave: async () => null,
          },
        }}
      />,
    );
    expect(screen.getByTitle("Открыть профиль").textContent).toBe(
      "i.ivanov@example.com",
    );
    // A deployment with the feature off renders the name unclickable.
    rerender(
      <QaSidebar
        {...base}
        account={{
          email: "i.ivanov@example.com",
          role: "user",
          onLogout: vi.fn(),
        }}
      />,
    );
    expect(screen.queryByTitle("Открыть профиль")).toBeNull();
    expect(screen.getByText("i.ivanov@example.com")).toBeTruthy();
  });
});
