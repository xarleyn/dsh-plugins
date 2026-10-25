// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OperatorCard } from "../../src/client/operator-card.js";
import type { OperatorCardFace } from "../../src/client/operator-card.js";
import type { ComponentType } from "react";
import { SERVICE_POLICY_OPERATIONS } from "../../src/service-credentials/catalog.js";

// The Host's panel hooks are unrelated to this body-only card.
const Card = OperatorCard as unknown as ComponentType<OperatorCardFace>;

function settingsForm() {
  const snapshot = {
    status: "ready" as const,
    writable: true,
    revision: 1,
    base: undefined,
    user: undefined,
    value: {
      managedServiceCredentials: {
        profiles: [
          {
            id: "build-reader",
            provider: "teamcity",
            instance: "teamcity",
            label: "Shared builds",
            enabled: true,
            credential: { secretEnv: "DEMO_SERVICE_TOKEN" },
            resources: { projects: ["demo-project"] },
          },
        ],
      },
    },
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    mutate: vi.fn(async () => {}),
    set: vi.fn(async () => {}),
    unset: vi.fn(async () => {}),
  };
}

describe("operator service operation catalog loading", () => {
  it("loads host metadata and saves the allowance with the whole profile", async () => {
    const form = settingsForm();
    const loader = vi.fn(async () => SERVICE_POLICY_OPERATIONS);
    render(
      <Card settingsForm={form as never} loadServiceOperations={loader} />,
    );
    const control = await screen.findByLabelText(
      "Читать лог сборки (builds.log)",
    );
    fireEvent.change(control, { target: { value: "allow" } });
    await waitFor(
      () =>
        expect(form.mutate).toHaveBeenCalledWith([
          expect.objectContaining({
            op: "set",
            path: ["managedServiceCredentials", "profiles"],
            value: [
              expect.objectContaining({
                id: "build-reader",
                resources: { projects: ["demo-project"] },
                policy: { "builds.log": "allow" },
              }),
            ],
          }),
        ]),
      // A workspace-wide test run starves the event loop long enough to
      // outlive the default one-second polling window.
      { timeout: 10_000 },
    );
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("shows a catalog load failure instead of presenting it as no operations", async () => {
    render(
      <Card
        settingsForm={settingsForm() as never}
        loadServiceOperations={async () => {
          throw new Error("Unavailable");
        }}
      />,
    );
    expect(
      await screen.findByText(
        /Не удалось загрузить операции сервисных аккаунтов/u,
      ),
    ).toBeDefined();
  });
});
