// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DomainExpertsPage, type DomainExpertsApi } from "../src/client/DomainExpertsPage.js";
import type { ApiOutcome } from "../src/client/remote.js";
import { emptyDomainDraft, type CatalogInfo, type DomainDefinition, type DomainSummary, type ResolvedExpertProfile } from "../src/types.js";

const CATALOG: CatalogInfo = {
  scopeProviders: [
    { id: "filesystem", title: "Filesystem", enforcement: "advisory", builtin: true },
  ],
  memoryProviders: [{ id: "builtin", title: "Built-in storage", builtin: true }],
  workers: [
    { id: "code_worker", title: "Code worker", capabilities: [], enforces: ["filesystem"], builtin: false },
  ],
  tools: [{ name: "domain_expert", provider: "@yadsh/dsh-domain-experts" }],
  memoryNamespaces: [],
};

const SUMMARY: DomainSummary = {
  id: "payments",
  name: "Payments",
  description: "Payment processing and settlement.",
  enabled: true,
  icon: "",
  color: "",
  primaryPaths: 1,
  sharedPaths: 1,
  memoryNamespaces: 1,
  tools: 2,
  degradations: 0,
  updatedAt: 10,
};

const DEFINITION: DomainDefinition = {
  ...emptyDomainDraft("payments", 10),
  name: "Payments",
  description: "Payment processing and settlement.",
  persona: { instructions: "Prefer the ledger." },
  scope: {
    filesystem: {
      primary: ["services/payments/**"],
      sharedReadOnly: ["packages/common/**"],
      denied: [],
    },
    documentation: { include: [], exclude: [] },
    providers: {},
  },
};

const PROFILE: ResolvedExpertProfile = {
  domainId: "payments",
  name: "Payments",
  description: "Payment processing and settlement.",
  enabled: true,
  basePolicy: "You are the designated expert for one domain.",
  customInstructions: "Prefer the ledger.",
  persona: "You are the designated expert for one domain.\n## Scope\n- services/payments/**",
  scope: {
    domainId: "payments",
    filesystem: { primary: ["services/payments/**"], sharedReadOnly: [], denied: [] },
    knowledge: { include: [], exclude: [] },
    external: {},
    memory: { namespace: "domain/payments", sharedNamespaces: [] },
  },
  resources: [
    {
      path: "services/payments/**",
      class: "primary",
      enforcement: "enforced",
      enforcedBy: ["code_worker"],
      provider: "filesystem",
      note: "Owned by this domain.",
    },
    {
      path: "packages/common/**",
      class: "shared",
      enforcement: "advisory",
      enforcedBy: [],
      provider: "filesystem",
      note: "Cross-domain resource.",
    },
  ],
  memory: [
    {
      namespace: "domain/payments",
      access: "read-write",
      enforcement: "enforced",
      provider: "namespace",
      note: "",
    },
  ],
  tools: [
    { name: "domain_expert", kind: "infrastructure", available: true, note: "Provided by this plugin." },
    { name: "code_worker", kind: "worker", available: true, note: "Code worker; enforces filesystem" },
  ],
  toolFilter: { allow: ["domain_expert", "code_worker"], deny: [] },
  delegation: {
    mode: "expert-only",
    allowCrossDomain: true,
    targets: [],
    maxDepth: 3,
    maxParallel: 3,
    peers: [{ domainId: "inventory", mode: "expert-only", allowed: true }],
  },
  model: DEFINITION.model,
  providers: [],
  degradations: [],
  depthBudget: 3,
  resolvedAt: 20,
};

function ok<T>(data: T): ApiOutcome<T> {
  return { ok: true, data };
}

function apiOf(overrides: Partial<DomainExpertsApi> = {}): DomainExpertsApi {
  return {
    listDomains: () => Promise.resolve(ok({ domains: [SUMMARY] })),
    getDomain: () => Promise.resolve(ok({ domain: DEFINITION })),
    draftDomain: () => Promise.resolve(ok({ domain: DEFINITION })),
    inspectDraft: () => Promise.resolve(ok({ ok: true, code: "", message: "", definition: DEFINITION, issues: [] })),
    createDomain: () => Promise.resolve(ok({ domain: DEFINITION })),
    updateDomain: () => Promise.resolve(ok({ domain: DEFINITION })),
    setDomainEnabled: () => Promise.resolve(ok({ domain: DEFINITION })),
    deleteDomain: () => Promise.resolve(ok({ deleted: true })),
    resolveScope: () => Promise.resolve(ok({ profile: PROFILE })),
    catalog: () => Promise.resolve(ok(CATALOG)),
    inspectMemory: () =>
      Promise.resolve(
        ok({
          ok: true,
          code: "",
          message: "",
          namespaces: [{ namespace: "domain/payments", access: "read-write", records: 1 }],
          records: [
            {
              namespace: "domain/payments",
              key: "cutoff",
              text: "Settlement closes at 14:00.",
              tags: [],
              createdAt: 1,
              updatedAt: 2,
            },
          ],
        }),
      ),
    clearMemory: () => Promise.resolve(ok({ cleared: 1 })),
    testExpert: () =>
      Promise.resolve(
        ok({
          result: { summary: "The batch aborts.", status: "completed", findings: [] },
        }),
      ),
    ...overrides,
  };
}

function renderPage(overrides: Partial<DomainExpertsApi> = {}) {
  return render(
    <DomainExpertsPage api={apiOf(overrides)} currentSessionId={() => "session-1"} />,
  );
}

describe("client page: list", () => {
  it("renders the loaded domains with their counts", async () => {
    renderPage();
    expect(await screen.findByText("Payments")).toBeTruthy();
    expect(screen.getByText(/1 primary paths/)).toBeTruthy();
  });

  it("shows an explicit empty state", async () => {
    renderPage({ listDomains: () => Promise.resolve(ok({ domains: [] })) });
    expect(await screen.findByText(/No domains yet/u)).toBeTruthy();
  });

  it("surfaces a refused list request with its code", async () => {
    renderPage({
      listDomains: () =>
        Promise.resolve({ ok: false, code: "STORAGE_UNAVAILABLE", message: "storage is closed" }),
    });
    expect(await screen.findByText(/STORAGE_UNAVAILABLE: storage is closed/u)).toBeTruthy();
  });

  it("toggles a domain through the list action", async () => {
    const setDomainEnabled = vi.fn(() => Promise.resolve(ok({ domain: DEFINITION })));
    renderPage({ setDomainEnabled });
    const toggle = await screen.findByText("Disable");
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(setDomainEnabled).toHaveBeenCalledWith("payments", false);
    });
  });
});

describe("client page: editor", () => {
  it("opens a domain and shows the resolved scope with enforcement labels", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("Payments"));
    expect(await screen.findByText(/Resolved scope — Payments/u)).toBeTruthy();
    expect(screen.getAllByText("enforced").length).toBeGreaterThan(0);
    expect(screen.getAllByText("advisory").length).toBeGreaterThan(0);
    expect(screen.getAllByText("code_worker").length).toBeGreaterThan(0);
  });

  it("moves through the editor tabs", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("Payments"));
    fireEvent.click(await screen.findByRole("tab", { name: "Persona" }));
    expect(await screen.findByText(/Composed persona/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Delegation" }));
    expect(screen.getByText(/Cross-domain policy/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Test" }));
    expect(screen.getByText(/Run test/u)).toBeTruthy();
  });

  it("renders a validation issue reported by the host", async () => {
    renderPage({
      inspectDraft: () =>
        Promise.resolve(
          ok({
            ok: true,
            code: "",
            message: "",
            definition: DEFINITION,
            issues: [
              {
                severity: "error" as const,
                field: "scope.filesystem.primary",
                message: 'Path "/etc/passwd" is invalid: absolute paths are outside the workspace.',
              },
            ],
          }),
        ),
    });
    fireEvent.click(await screen.findByText("Payments"));
    fireEvent.click(await screen.findByRole("tab", { name: "Resources" }));
    const input = await screen.findByPlaceholderText("services/payments/**");
    fireEvent.change(input, { target: { value: "/etc/passwd" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(screen.getByText(/absolute paths are outside the workspace/u)).toBeTruthy();
    });
  });

  it("creates a domain from an id in the header", async () => {
    const draftDomain = vi.fn(() => Promise.resolve(ok({ domain: DEFINITION })));
    renderPage({ draftDomain });
    fireEvent.change(await screen.findByPlaceholderText("new-domain-id"), {
      target: { value: "payments" },
    });
    fireEvent.click(screen.getByText("Add domain"));
    await waitFor(() => {
      expect(draftDomain).toHaveBeenCalledWith("payments");
    });
    expect(await screen.findByText("New domain")).toBeTruthy();
  });

  it("saves an edited domain and reports success", async () => {
    const updateDomain = vi.fn(() => Promise.resolve(ok({ domain: DEFINITION })));
    renderPage({ updateDomain });
    fireEvent.click(await screen.findByText("Payments"));
    fireEvent.click(await screen.findByRole("tab", { name: "General" }));
    fireEvent.change(screen.getByDisplayValue("Payments"), { target: { value: "Payments v2" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => {
      expect(updateDomain).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("Changes saved.")).toBeTruthy();
  });

  it("reports a refused write instead of pretending it saved", async () => {
    renderPage({
      updateDomain: () =>
        Promise.resolve({ ok: false, code: "DOMAIN_INVALID", message: "id is reserved" }),
    });
    fireEvent.click(await screen.findByText("Payments"));
    fireEvent.click(await screen.findByText("Save"));
    expect(await screen.findByText(/DOMAIN_INVALID: id is reserved/u)).toBeTruthy();
  });
});

describe("client page: degraded configuration", () => {
  it("lists a missing scope provider with the references that caused it", async () => {
    renderPage({
      resolveScope: () =>
        Promise.resolve(
          ok({
            profile: {
              ...PROFILE,
              degradations: [
                {
                  code: "SCOPE_PROVIDER_MISSING" as const,
                  message:
                    'Domain "payments" configures scope provider "jira", but no provider with that id is registered.',
                  refs: ["jira"],
                },
              ],
              providers: [
                {
                  id: "jira",
                  title: "jira",
                  registered: false,
                  enforcement: "advisory" as const,
                  note: 'No scope provider with id "jira" is registered.',
                },
              ],
            },
          }),
        ),
    });
    fireEvent.click(await screen.findByText("Payments"));
    expect(await screen.findByText(/Degraded configuration/u)).toBeTruthy();
    expect(screen.getByText("SCOPE_PROVIDER_MISSING")).toBeTruthy();
    expect(screen.getByText(/no provider with that id is registered/u)).toBeTruthy();
    expect(screen.getByText("no")).toBeTruthy();
  });

  it("surfaces a refused scope resolution instead of rendering an empty inspector", async () => {
    renderPage({
      resolveScope: () =>
        Promise.resolve({ ok: false, code: "DOMAIN_DISABLED", message: "domain is disabled" }),
    });
    fireEvent.click(await screen.findByText("Payments"));
    expect(await screen.findByText(/DOMAIN_DISABLED: domain is disabled/u)).toBeTruthy();
  });
});

describe("client page: memory and test", () => {
  it("inspects memory from the editor", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("Payments"));
    fireEvent.click(await screen.findByRole("tab", { name: "Memory" }));
    fireEvent.click(screen.getByText("Inspect memory"));
    expect(await screen.findByText(/Settlement closes at 14:00./u)).toBeTruthy();
  });

  it("runs a test and shows the answer", async () => {
    const testExpert = vi.fn(() =>
      Promise.resolve(
        ok({ result: { summary: "The batch aborts.", status: "completed", findings: [] } }),
      ),
    );
    renderPage({ testExpert });
    fireEvent.click(await screen.findByText("Payments"));
    fireEvent.click(await screen.findByRole("tab", { name: "Test" }));
    fireEvent.click(screen.getByText("Run test"));
    await waitFor(() => {
      expect(testExpert).toHaveBeenCalledWith("payments", expect.any(String), "session-1");
    });
    expect(await screen.findByText(/The batch aborts./u)).toBeTruthy();
  });

  it("surfaces a refused test run", async () => {
    renderPage({
      testExpert: () =>
        Promise.resolve({ ok: false, code: "TASK_REJECTED", message: "no live session" }),
    });
    fireEvent.click(await screen.findByText("Payments"));
    fireEvent.click(await screen.findByRole("tab", { name: "Test" }));
    fireEvent.click(screen.getByText("Run test"));
    expect(await screen.findByText(/TASK_REJECTED: no live session/u)).toBeTruthy();
  });
});
