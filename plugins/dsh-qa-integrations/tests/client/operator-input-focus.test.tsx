// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import { StrictMode, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  InstanceListField,
  useDraftRowIdentity,
  type InstanceDraft,
} from "../../src/client/operator-controls.js";
import { ServiceAccessSection } from "../../src/client/operator-sections/service-profiles.js";

const instances: readonly InstanceDraft[] = [
  { id: "first", label: "First demo", baseUrl: "https://one.example.com" },
  { id: "second", label: "Second demo", baseUrl: "https://two.example.com" },
];

function typeWhileFocused(input: HTMLInputElement, values: readonly string[]) {
  input.focus();
  for (const value of values) {
    fireEvent.change(input, { target: { value } });
    expect(document.activeElement).toBe(input);
    expect(input.isConnected).toBe(true);
    input.setSelectionRange(value.length, value.length);
  }
}

function openProfiles() {
  const section = screen.getByTestId("qa-integrations-service-access");
  fireEvent.click(section.querySelector("summary")!);
  expect(section).toHaveProperty("open", true);
}

describe("operator editable row identity", () => {
  it("reconciles the same updater input consistently without changing its stored baseline", () => {
    const { result } = renderHook(() => useDraftRowIdentity<InstanceDraft>());
    const stored = instances[0]!;
    const draft = result.current.patch(stored, { label: "Unsaved demo" });
    const incoming = [{ ...stored, label: "Host changed demo" }];
    const first = result.current.reconcile(incoming, [draft], 1);
    const replay = result.current.reconcile(incoming, [draft], 1);
    expect(first[0]?.label).toBe("Host changed demo");
    expect(replay[0]?.label).toBe(first[0]?.label);
    expect(result.current.key(replay[0]!)).toBe(result.current.key(draft));
  });

  it("keeps the instance id input and caret through typing and an async Host echo", async () => {
    let acknowledge!: () => void;
    const write = vi.fn();
    function Editor() {
      const [stored, setStored] = useState(instances);
      return (
        <InstanceListField
          label="Demo instances"
          path={["gitlab", "instances"]}
          instances={stored}
          disabled={false}
          overridden={() => false}
          unset={() => undefined}
          write={async (path, next) => {
            write(path, next);
            await new Promise<void>((resolve) => {
              acknowledge = resolve;
            });
            setStored(
              (next as readonly InstanceDraft[]).map((row) => ({ ...row })),
            );
          }}
        />
      );
    }
    render(<Editor />);
    const id = screen.getAllByTestId(
      "qa-integrations-gitlab-instances-id-input",
    )[0] as HTMLInputElement;
    typeWhileFocused(id, ["fir", "first-new", "first-renamed"]);
    fireEvent.blur(id);
    expect(write).toHaveBeenCalledWith(
      ["gitlab", "instances"],
      [{ ...instances[0], id: "first-renamed" }, instances[1]],
    );
    await act(async () => acknowledge());
    expect(
      screen.getAllByTestId("qa-integrations-gitlab-instances-id-input")[0],
    ).toBe(id);
    expect(document.activeElement).toBe(id);
    expect(id.selectionStart).toBe("first-renamed".length);
  });

  it("keeps a pending instance row when an earlier stored row is removed", () => {
    const write = vi.fn();
    render(
      <InstanceListField
        label="Demo instances"
        path={["gitlab", "instances"]}
        instances={instances}
        disabled={false}
        overridden={() => false}
        unset={() => undefined}
        write={write}
      />,
    );
    fireEvent.click(screen.getByTestId("qa-integrations-gitlab-instances-add"));
    const pending = screen.getAllByTestId(
      "qa-integrations-gitlab-instances-id-input",
    )[2] as HTMLInputElement;
    typeWhileFocused(pending, ["d", "draft"]);
    fireEvent.click(
      screen.getAllByTestId("qa-integrations-gitlab-instances-remove")[0]!,
    );
    expect(
      screen.getAllByTestId("qa-integrations-gitlab-instances-id-input")[1],
    ).toBe(pending);
    expect(document.activeElement).toBe(pending);
    expect(pending.value).toBe("draft");
    expect(write).toHaveBeenLastCalledWith(
      ["gitlab", "instances"],
      [instances[1]],
    );
  });

  it("keeps the service-profile id through typing and an async Host echo without publishing a client key", async () => {
    let acknowledge!: () => void;
    const write = vi.fn();
    const initial = [
      {
        id: "read-only",
        provider: "gitlab",
        instance: "demo",
        label: "Demo profile",
        enabled: true,
        resources: { projects: ["demo/repository"] },
      },
    ];
    function Editor() {
      const [profiles, setProfiles] = useState<unknown>(initial);
      return (
        <ServiceAccessSection
          form={{
            config: { managedServiceCredentials: { profiles } },
            control: {
              disabled: false,
              overridden: () => false,
              unset: () => undefined,
              write: async (path, next) => {
                write(path, next);
                await new Promise<void>((resolve) => {
                  acknowledge = resolve;
                });
                setProfiles(structuredClone(next));
              },
            },
            toggle: () => <span />,
          }}
        />
      );
    }
    render(<Editor />);
    openProfiles();
    const row = screen.getByTestId("qa-integrations-service-access-profile-0");
    const id = row.querySelector<HTMLInputElement>("input[type='text']")!;
    typeWhileFocused(id, ["r", "read", "read-new"]);
    fireEvent.blur(id);
    expect(write).toHaveBeenCalledWith(
      ["managedServiceCredentials", "profiles"],
      [{ ...initial[0], id: "read-new" }],
    );
    await act(async () => acknowledge());
    expect(screen.getByTestId("qa-integrations-service-access-profile-0")).toBe(
      row,
    );
    expect(row.querySelector("input[type='text']")).toBe(id);
    expect(document.activeElement).toBe(id);
    expect(id.selectionStart).toBe("read-new".length);
  });

  it.each([1, 2, 3, 4])(
    "keeps the service-profile text field %i focused while its draft changes",
    (index) => {
      render(
        <ServiceAccessSection
          form={{
            config: {
              managedServiceCredentials: {
                profiles: [
                  {
                    id: "saved",
                    provider: "gitlab",
                    instance: "demo",
                    label: "Saved demo",
                    enabled: true,
                    resources: { projects: ["demo/repository"] },
                  },
                ],
              },
            },
            control: {
              disabled: false,
              overridden: () => false,
              unset: () => undefined,
              write: () => undefined,
            },
            toggle: () => <span />,
          }}
        />,
      );
      openProfiles();
      const row = screen.getByTestId(
        "qa-integrations-service-access-profile-0",
      );
      const input = row.querySelectorAll<HTMLInputElement>(
        ".qai-op__profile-grid input[type='text']",
      )[index]!;
      typeWhileFocused(input, ["d", "demo-value"]);
      expect(
        screen.getByTestId("qa-integrations-service-access-profile-0"),
      ).toBe(row);
    },
  );

  it("keeps a pending service profile and its resource draft when an earlier profile is removed", () => {
    const write = vi.fn();
    render(
      <ServiceAccessSection
        form={{
          config: {
            managedServiceCredentials: {
              profiles: [
                {
                  id: "saved",
                  provider: "gitlab",
                  instance: "demo",
                  label: "Saved demo",
                  enabled: true,
                },
              ],
            },
          },
          control: {
            disabled: false,
            overridden: () => false,
            unset: () => undefined,
            write,
          },
          toggle: () => <span />,
        }}
      />,
    );
    openProfiles();
    fireEvent.click(
      screen.getByTestId("qa-integrations-service-access-add-profile"),
    );
    const pendingRow = screen.getByTestId(
      "qa-integrations-service-access-profile-1",
    );
    const id =
      pendingRow.querySelector<HTMLInputElement>("input[type='text']")!;
    typeWhileFocused(id, ["d", "draft"]);
    const resourceDraft = within(pendingRow).getByTestId(
      "qa-integrations-service-access-profile-1-resources-key-input",
    ) as HTMLInputElement;
    typeWhileFocused(resourceDraft, ["proj", "projects"]);
    fireEvent.click(
      within(
        screen.getByTestId("qa-integrations-service-access-profile-0"),
      ).getByRole("button", { name: "убрать" }),
    );
    expect(screen.getByTestId("qa-integrations-service-access-profile-0")).toBe(
      pendingRow,
    );
    expect(
      within(pendingRow).getByTestId(
        "qa-integrations-service-access-profile-0-resources-key-input",
      ),
    ).toBe(resourceDraft);
    expect(document.activeElement).toBe(resourceDraft);
    expect(resourceDraft.value).toBe("projects");
    expect(write).not.toHaveBeenCalled();
  });

  it.each(["delete", "reorder"])(
    "keeps the focused surviving instance after a Host %s",
    async (change) => {
      let refuel!: (rows: readonly InstanceDraft[]) => void;
      function Editor() {
        const [stored, setStored] = useState(instances);
        refuel = setStored;
        return (
          <InstanceListField
            label="Demo instances"
            path={["gitlab", "instances"]}
            instances={stored}
            disabled={false}
            overridden={() => false}
            unset={() => undefined}
            write={() => undefined}
          />
        );
      }
      render(<Editor />);
      const focused = screen.getAllByTestId(
        "qa-integrations-gitlab-instances-id-input",
      )[1] as HTMLInputElement;
      focused.focus();
      focused.setSelectionRange(2, 2);
      await act(async () =>
        refuel(
          (change === "delete"
            ? [instances[1]!]
            : [instances[1]!, instances[0]!]
          ).map((row) => ({ ...row })),
        ),
      );
      expect(
        screen.getAllByTestId("qa-integrations-gitlab-instances-id-input")[0],
      ).toBe(focused);
      expect(document.activeElement).toBe(focused);
      expect(focused.selectionStart).toBe(2);
      expect(focused.value).toBe("second");
    },
  );

  it.each(["id", "label", "base-url"])(
    "keeps the unsaved instance %s through an equal fresh Host snapshot",
    async (field) => {
      let refuel!: () => void;
      const write = vi.fn();
      function Editor() {
        const [stored, setStored] = useState(instances);
        refuel = () => setStored(instances.map((row) => ({ ...row })));
        return (
          <InstanceListField
            label="Demo instances"
            path={["gitlab", "instances"]}
            instances={stored}
            disabled={false}
            overridden={() => false}
            unset={() => undefined}
            write={write}
          />
        );
      }
      render(<Editor />);
      const input = screen.getAllByTestId(
        `qa-integrations-gitlab-instances-${field}-input`,
      )[0] as HTMLInputElement;
      typeWhileFocused(input, ["draft", "draft-value"]);
      input.setSelectionRange(3, 3);
      await act(async () => refuel());
      expect(
        screen.getAllByTestId(
          `qa-integrations-gitlab-instances-${field}-input`,
        )[0],
      ).toBe(input);
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe("draft-value");
      expect(input.selectionStart).toBe(3);
      expect(write).not.toHaveBeenCalled();
    },
  );

  it.each(["delete", "reorder"])(
    "keeps the focused surviving service profile after a Host %s",
    async (change) => {
      const initial = ["first", "second"].map((id) => ({
        id,
        provider: "gitlab",
        instance: "demo",
        label: `${id} demo`,
        enabled: true,
        resources: { projects: ["demo/repository"] },
      }));
      let refuel!: (rows: typeof initial) => void;
      function Editor() {
        const [profiles, setProfiles] = useState(initial);
        refuel = setProfiles;
        return (
          <ServiceAccessSection
            form={{
              config: { managedServiceCredentials: { profiles } },
              control: {
                disabled: false,
                overridden: () => false,
                unset: () => undefined,
                write: () => undefined,
              },
              toggle: () => <span />,
            }}
          />
        );
      }
      render(<Editor />);
      openProfiles();
      const row = screen.getByTestId(
        "qa-integrations-service-access-profile-1",
      );
      const focused =
        row.querySelector<HTMLInputElement>("input[type='text']")!;
      focused.focus();
      focused.setSelectionRange(2, 2);
      await act(async () =>
        refuel(
          structuredClone(
            change === "delete" ? [initial[1]!] : [initial[1]!, initial[0]!],
          ),
        ),
      );
      expect(
        screen.getByTestId("qa-integrations-service-access-profile-0"),
      ).toBe(row);
      expect(document.activeElement).toBe(focused);
      expect(focused.selectionStart).toBe(2);
      expect(focused.value).toBe("second");
    },
  );

  it.each([0, 2, "resource"])(
    "keeps the unsaved service-profile field %s through an equal fresh Host snapshot",
    async (field) => {
      const initial = [
        {
          id: "saved",
          provider: "gitlab",
          instance: "demo",
          label: "Saved demo",
          enabled: true,
          resources: { projects: ["demo/repository"] },
        },
      ];
      let refuel!: () => void;
      const write = vi.fn();
      function Editor() {
        const [profiles, setProfiles] = useState(initial);
        refuel = () => setProfiles(structuredClone(initial));
        return (
          <ServiceAccessSection
            form={{
              config: { managedServiceCredentials: { profiles } },
              control: {
                disabled: false,
                overridden: () => false,
                unset: () => undefined,
                write,
              },
              toggle: () => <span />,
            }}
          />
        );
      }
      render(<Editor />);
      openProfiles();
      const row = screen.getByTestId(
        "qa-integrations-service-access-profile-0",
      );
      const input =
        field === "resource"
          ? (within(row).getByTestId(
              "qa-integrations-service-access-profile-0-resources-key-input",
            ) as HTMLInputElement)
          : row.querySelectorAll<HTMLInputElement>(
              ".qai-op__profile-grid input[type='text']",
            )[field as number]!;
      typeWhileFocused(input, ["draft", "draft-value"]);
      input.setSelectionRange(3, 3);
      await act(async () => refuel());
      expect(
        screen.getByTestId("qa-integrations-service-access-profile-0"),
      ).toBe(row);
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe("draft-value");
      expect(input.selectionStart).toBe(3);
      expect(write).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    "keeps an earlier incomplete instance draft when the Host accepts a later complete draft (StrictMode %s)",
    async (strict) => {
      let acknowledge!: () => void;
      function Editor() {
        const [stored, setStored] = useState<readonly InstanceDraft[]>(
          instances.slice(0, 1),
        );
        return (
          <InstanceListField
            label="Demo instances"
            path={["gitlab", "instances"]}
            instances={stored}
            disabled={false}
            overridden={() => false}
            unset={() => undefined}
            write={async (_path, next) => {
              await new Promise<void>((resolve) => {
                acknowledge = resolve;
              });
              setStored(structuredClone(next as readonly InstanceDraft[]));
            }}
          />
        );
      }
      render(
        strict ? (
          <StrictMode>
            <Editor />
          </StrictMode>
        ) : (
          <Editor />
        ),
      );
      fireEvent.click(
        screen.getByTestId("qa-integrations-gitlab-instances-add"),
      );
      const incomplete = screen.getAllByTestId(
        "qa-integrations-gitlab-instances-id-input",
      )[1] as HTMLInputElement;
      fireEvent.change(incomplete, { target: { value: "pending" } });
      fireEvent.click(
        screen.getByTestId("qa-integrations-gitlab-instances-add"),
      );
      const completed = screen.getAllByTestId(
        "qa-integrations-gitlab-instances-row",
      )[2]!;
      fireEvent.change(
        within(completed).getByTestId(
          "qa-integrations-gitlab-instances-id-input",
        ),
        { target: { value: "accepted" } },
      );
      fireEvent.change(
        within(completed).getByTestId(
          "qa-integrations-gitlab-instances-label-input",
        ),
        { target: { value: "Accepted demo" } },
      );
      const address = within(completed).getByTestId(
        "qa-integrations-gitlab-instances-base-url-input",
      );
      fireEvent.change(address, {
        target: { value: "https://accepted.example.com" },
      });
      fireEvent.blur(address);
      incomplete.focus();
      await act(async () => acknowledge());
      expect(
        screen
          .getAllByTestId("qa-integrations-gitlab-instances-id-input")
          .map((input) => (input as HTMLInputElement).value),
      ).toEqual(["first", "accepted", "pending"]);
      expect(
        screen.getAllByTestId("qa-integrations-gitlab-instances-id-input")[2],
      ).toBe(incomplete);
      expect(document.activeElement).toBe(incomplete);
    },
  );

  it.each([false, true])(
    "keeps an earlier incomplete service-profile draft when the Host accepts a later complete draft (StrictMode %s)",
    async (strict) => {
      let acknowledge!: () => void;
      const initial = [
        {
          id: "saved",
          provider: "gitlab",
          instance: "demo",
          label: "Saved demo",
          enabled: true,
          resources: { projects: ["demo/repository"] },
        },
      ];
      function Editor() {
        const [profiles, setProfiles] = useState<unknown>(initial);
        return (
          <ServiceAccessSection
            form={{
              config: { managedServiceCredentials: { profiles } },
              control: {
                disabled: false,
                overridden: () => false,
                unset: () => undefined,
                write: async (_path, next) => {
                  await new Promise<void>((resolve) => {
                    acknowledge = resolve;
                  });
                  setProfiles(structuredClone(next));
                },
              },
              toggle: () => <span />,
            }}
          />
        );
      }
      render(
        strict ? (
          <StrictMode>
            <Editor />
          </StrictMode>
        ) : (
          <Editor />
        ),
      );
      openProfiles();
      fireEvent.click(
        screen.getByTestId("qa-integrations-service-access-add-profile"),
      );
      const incompleteRow = screen.getByTestId(
        "qa-integrations-service-access-profile-1",
      );
      const incomplete =
        incompleteRow.querySelector<HTMLInputElement>("input[type='text']")!;
      fireEvent.change(incomplete, { target: { value: "pending" } });
      fireEvent.click(
        screen.getByTestId("qa-integrations-service-access-add-profile"),
      );
      const completed = screen.getByTestId(
        "qa-integrations-service-access-profile-2",
      );
      const inputs = completed.querySelectorAll<HTMLInputElement>(
        ".qai-op__profile-grid input[type='text']",
      );
      fireEvent.change(inputs[0]!, { target: { value: "accepted" } });
      fireEvent.change(inputs[1]!, { target: { value: "demo" } });
      fireEvent.change(
        within(completed).getByTestId(
          "qa-integrations-service-access-profile-2-resources-key-input",
        ),
        { target: { value: "projects" } },
      );
      fireEvent.change(
        within(completed).getByTestId(
          "qa-integrations-service-access-profile-2-resources-value-input",
        ),
        { target: { value: "demo/repository" } },
      );
      fireEvent.click(
        within(completed).getByTestId(
          "qa-integrations-service-access-profile-2-resources-add",
        ),
      );
      incomplete.focus();
      await act(async () => acknowledge());
      expect(
        screen.getByTestId("qa-integrations-service-access-profile-2"),
      ).toBe(incompleteRow);
      expect(document.activeElement).toBe(incomplete);
      expect(
        screen
          .getByTestId("qa-integrations-service-access-profile-1")
          .querySelector<HTMLInputElement>("input[type='text']")?.value,
      ).toBe("accepted");
      expect(incomplete.value).toBe("pending");
    },
  );

  it("matches stored instance lineage before a colliding unsaved id and refreshes unchanged fields", async () => {
    let refuel!: () => void;
    function Editor() {
      const [stored, setStored] = useState(instances);
      refuel = () =>
        setStored([
          { ...instances[1]! },
          { ...instances[0]!, label: "Host changed demo" },
        ]);
      return (
        <InstanceListField
          label="Demo instances"
          path={["gitlab", "instances"]}
          instances={stored}
          disabled={false}
          overridden={() => false}
          unset={() => undefined}
          write={() => undefined}
        />
      );
    }
    render(<Editor />);
    const input = screen.getAllByTestId(
      "qa-integrations-gitlab-instances-id-input",
    )[0] as HTMLInputElement;
    typeWhileFocused(input, ["second"]);
    await act(async () => refuel());
    expect(
      screen.getAllByTestId("qa-integrations-gitlab-instances-id-input")[1],
    ).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("second");
    expect(
      screen.getAllByTestId("qa-integrations-gitlab-instances-label-input")[1],
    ).toHaveProperty("value", "Host changed demo");
  });

  it("matches stored service-profile lineage before a colliding unsaved id and refreshes unchanged fields", async () => {
    const initial = ["first", "second"].map((id) => ({
      id,
      provider: "gitlab",
      instance: "demo",
      label: `${id} demo`,
      enabled: true,
      resources: { projects: ["demo/repository"] },
    }));
    let refuel!: () => void;
    function Editor() {
      const [profiles, setProfiles] = useState(initial);
      refuel = () =>
        setProfiles([
          { ...initial[1]! },
          { ...initial[0]!, label: "Host changed demo" },
        ]);
      return (
        <ServiceAccessSection
          form={{
            config: { managedServiceCredentials: { profiles } },
            control: {
              disabled: false,
              overridden: () => false,
              unset: () => undefined,
              write: () => undefined,
            },
            toggle: () => <span />,
          }}
        />
      );
    }
    render(<Editor />);
    openProfiles();
    const row = screen.getByTestId("qa-integrations-service-access-profile-0");
    const input = row.querySelector<HTMLInputElement>("input[type='text']")!;
    typeWhileFocused(input, ["second"]);
    await act(async () => refuel());
    expect(screen.getByTestId("qa-integrations-service-access-profile-1")).toBe(
      row,
    );
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("second");
    expect(
      row.querySelectorAll<HTMLInputElement>(
        ".qai-op__profile-grid input[type='text']",
      )[2],
    ).toHaveProperty("value", "Host changed demo");
  });

  it("accepts typed resource text as comma-separated wire resources without replacing its input", () => {
    const write = vi.fn();
    render(
      <ServiceAccessSection
        form={{
          config: {
            managedServiceCredentials: {
              profiles: [
                {
                  id: "saved",
                  provider: "gitlab",
                  instance: "demo",
                  label: "Saved demo",
                  enabled: true,
                  resources: { projects: ["demo/repository"] },
                },
              ],
            },
          },
          control: {
            disabled: false,
            overridden: () => false,
            unset: () => undefined,
            write,
          },
          toggle: () => <span />,
        }}
      />,
    );
    openProfiles();
    const row = screen.getByTestId("qa-integrations-service-access-profile-0");
    const key = within(row).getByTestId(
      "qa-integrations-service-access-profile-0-resources-key-input",
    ) as HTMLInputElement;
    const value = within(row).getByTestId(
      "qa-integrations-service-access-profile-0-resources-value-input",
    ) as HTMLInputElement;
    typeWhileFocused(key, ["gr", "groups"]);
    typeWhileFocused(value, ["demo", "demo/one, demo/two"]);
    fireEvent.click(
      within(row).getByTestId(
        "qa-integrations-service-access-profile-0-resources-add",
      ),
    );
    expect(
      within(row).getByTestId(
        "qa-integrations-service-access-profile-0-resources-value-input",
      ),
    ).toBe(value);
    expect(write).toHaveBeenLastCalledWith(
      ["managedServiceCredentials", "profiles"],
      [
        {
          id: "saved",
          provider: "gitlab",
          instance: "demo",
          label: "Saved demo",
          enabled: true,
          resources: {
            projects: ["demo/repository"],
            groups: ["demo/one", "demo/two"],
          },
        },
      ],
    );
  });

  it("applies an authoritative Host field update once when StrictMode replays reconciliation", async () => {
    let refuel!: () => void;
    function Editor() {
      const [stored, setStored] = useState(instances);
      refuel = () =>
        setStored(
          instances.map((row, index) =>
            index === 0 ? { ...row, label: "Host changed demo" } : { ...row },
          ),
        );
      return (
        <InstanceListField
          label="Demo instances"
          path={["gitlab", "instances"]}
          instances={stored}
          disabled={false}
          overridden={() => false}
          unset={() => undefined}
          write={() => undefined}
        />
      );
    }
    render(
      <StrictMode>
        <Editor />
      </StrictMode>,
    );
    const input = screen.getAllByTestId(
      "qa-integrations-gitlab-instances-label-input",
    )[0] as HTMLInputElement;
    typeWhileFocused(input, ["Unsaved demo"]);
    await act(async () => refuel());
    expect(
      screen.getAllByTestId("qa-integrations-gitlab-instances-label-input")[0],
    ).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("Host changed demo");
  });
});
