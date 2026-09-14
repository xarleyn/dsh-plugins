// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QaSidebar } from "../src/client/components/QaSidebar.js";
import { QaUserSettingsDialog } from "../src/client/user-settings/UserSettingsDialog.js";
import { QaGeneralSettingsPage } from "../src/client/user-settings/GeneralSettingsPage.js";
import type {
  QaAccountIdentityField,
  QaAccountProfile,
  QaSkillDocument,
  QaSkillSummary,
} from "../src/types.js";
import type { QaBoundSkillApi } from "../src/client/types.js";

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

function summary(overrides: Partial<QaSkillSummary> = {}): QaSkillSummary {
  return {
    name: "api-testing",
    description: "Тестирование REST и GraphQL API",
    whenToUse: null,
    modelInvocable: true,
    userInvocable: true,
    allowedTools: ["read", "grep"],
    unavailableTools: [],
    resourceCount: 0,
    valid: true,
    diagnostics: [],
    updatedAt: null,
    revision: "rev-1",
    ...overrides,
  };
}

function skillDocument(
  overrides: Partial<QaSkillDocument> = {},
): QaSkillDocument {
  return {
    ...summary(),
    body: "1. Шаг",
    extraFrontmatter: {},
    sourcePath: "/workspace/.dsh/skills/api-testing/SKILL.md",
    preview: "---\nname: api-testing\n---\n\n1. Шаг\n",
    ...overrides,
  };
}

/** A skill API that answers with the given catalog and records its calls. */
function skillApi(
  options: {
    readonly skills?: readonly QaSkillSummary[];
    readonly documents?: Readonly<Record<string, QaSkillDocument>>;
    readonly tools?: readonly import("../src/types.js").QaSkillToolDescriptor[];
  } = {},
): {
  readonly api: QaBoundSkillApi;
  readonly calls: {
    readonly created: readonly unknown[];
    readonly updated: readonly unknown[];
    readonly removed: readonly unknown[];
  };
  readonly created: unknown[];
  readonly updated: unknown[];
  readonly removed: unknown[];
} {
  const created: unknown[] = [];
  const updated: unknown[] = [];
  const removed: unknown[] = [];
  const skills = options.skills ?? [];
  const documents = options.documents ?? {};
  const api: QaBoundSkillApi = {
    list: async () => ({ ok: true, value: skills }),
    get: async (name) =>
      documents[name] === undefined
        ? { ok: false, error: new Error("(reason: skill-not-found)") }
        : { ok: true, value: documents[name] },
    create: async (input) => {
      created.push(input);
      return { ok: true, value: skillDocument({ name: input.name }) };
    },
    update: async (name, input) => {
      updated.push({ name, input });
      return { ok: true, value: skillDocument({ name: input.name }) };
    },
    remove: async (name, expectedRevision) => {
      removed.push({ name, expectedRevision });
      return { ok: true, value: { name, trashed: true } };
    },
    tools: async () => ({
      ok: true,
      value: options.tools ?? [
        { name: "read", description: "Read a file", available: true },
        { name: "write", description: "Write a file", available: false },
      ],
    }),
  };
  return {
    api,
    calls: { created, updated, removed },
    created,
    updated,
    removed,
  };
}

function dialog(props: {
  readonly initialSection?: "profile" | "general" | "skills";
  readonly withProfile?: boolean;
  readonly skills?: QaBoundSkillApi;
  readonly onSave?: (input: unknown) => Promise<string | null>;
  readonly onClose?: () => void;
}) {
  return render(
    <QaUserSettingsDialog
      open
      initialSection={props.initialSection ?? "profile"}
      email="i.ivanov@example.com"
      role="user"
      chatCount={3}
      onClose={props.onClose ?? vi.fn()}
      {...(props.withProfile === false
        ? {}
        : {
            profile: {
              profile: profile({
                fullName: "Иван Иванов",
                identities: { jira: "i.ivanov" },
                instructions: "Отвечай кратко.",
              }),
              fields: FIELDS,
              instructionsMaxLength: 2_000,
              onSave: (props.onSave ?? vi.fn(async () => null)) as never,
            },
          })}
      {...(props.skills === undefined ? {} : { skills: props.skills })}
    />,
  );
}

describe("QA settings dialog", () => {
  it("opens on the profile with the stored values, inside one shell", () => {
    const { container } = dialog({});
    expect(screen.getByRole("dialog", { name: "Настройки" })).toBeTruthy();
    expect(
      container.querySelector(".dsh-qa-modal__panel--settings"),
    ).toBeTruthy();
    expect((screen.getByLabelText("ФИО") as HTMLInputElement).value).toBe(
      "Иван Иванов",
    );
    expect((screen.getByLabelText("Jira") as HTMLInputElement).value).toBe(
      "i.ivanov",
    );
    expect((screen.getByLabelText("Email") as HTMLInputElement).readOnly).toBe(
      true,
    );
  });

  it("navigates between sections without leaving the dialog", () => {
    const skills = skillApi({ skills: [summary()] });
    dialog({ skills: skills.api });
    expect(screen.getByRole("tab", { name: "Профиль" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Общие" }));
    expect(screen.getByRole("tabpanel", { name: "Общие" })).toBeTruthy();
    expect(screen.getByText("i.ivanov@example.com")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Навыки" }));
    expect(screen.getByRole("tabpanel", { name: "Навыки" })).toBeTruthy();
    // One dialog the whole time: the sections are pages, not further modals.
    expect(document.querySelectorAll(".dsh-qa-modal").length).toBe(1);
  });

  it("hides the sections a deployment withheld", () => {
    dialog({ withProfile: false });
    expect(screen.queryByRole("tab", { name: "Профиль" })).toBeNull();
    // Without a profile the dialog still opens on something useful.
    expect(screen.getByRole("tabpanel", { name: "Общие" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Навыки" })).toBeNull();
  });

  it("saves the profile through the migrated page", async () => {
    const onSave = vi.fn(async () => null);
    dialog({ onSave });
    fireEvent.change(screen.getByLabelText("GitLab"), {
      target: { value: "@iivanov" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        fullName: "Иван Иванов",
        identities: { jira: "i.ivanov", gitlab: "@iivanov" },
        instructions: "Отвечай кратко.",
      });
    });
    expect(await screen.findByText("Профиль сохранён.")).toBeTruthy();
  });

  it("keeps the page open and shows the refusal copy", async () => {
    dialog({ onSave: async () => "Проверьте поля профиля." });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Проверьте поля профиля.",
    );
  });

  it("closes on Escape and on a backdrop click", () => {
    const onClose = vi.fn();
    const { container } = dialog({ onClose });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector(".dsh-qa-modal") as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("QA settings general page", () => {
  it("shows the account facts and names what is managed elsewhere", () => {
    render(
      <QaGeneralSettingsPage
        email="i.ivanov@example.com"
        role="admin"
        chatCount={7}
      />,
    );
    expect(screen.getByText("i.ivanov@example.com")).toBeTruthy();
    expect(screen.getByText("admin")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText(/задаёт администратор/u)).toBeTruthy();
  });
});

describe("QA sidebar settings entry point", () => {
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

  it("opens the settings dialog from the account name", () => {
    const onOpen = vi.fn();
    render(
      <QaSidebar
        {...base}
        account={{
          email: "i.ivanov@example.com",
          role: "admin",
          onLogout: vi.fn(),
          settings: { label: "Иван Иванов", onOpen },
        }}
      />,
    );
    expect(screen.getByText("Иван Иванов")).toBeTruthy();
    fireEvent.click(screen.getByTitle("Открыть настройки"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("falls back to the email and stays plain text without settings", () => {
    const { rerender } = render(
      <QaSidebar
        {...base}
        account={{
          email: "i.ivanov@example.com",
          role: "user",
          onLogout: vi.fn(),
          settings: { label: "i.ivanov@example.com", onOpen: vi.fn() },
        }}
      />,
    );
    expect(screen.getByTitle("Открыть настройки").textContent).toBe(
      "i.ivanov@example.com",
    );
    // A deployment with nothing to configure renders the name unclickable.
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
    expect(screen.queryByTitle("Открыть настройки")).toBeNull();
    expect(screen.getByText("i.ivanov@example.com")).toBeTruthy();
  });
});
