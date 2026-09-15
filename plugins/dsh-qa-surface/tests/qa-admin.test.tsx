// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QaAdmin } from "../src/client/admin/QaAdmin.js";
import type { QaAccessApi } from "../src/client/types.js";

function api(): QaAccessApi {
  const snapshot = {
    config: {
      version: 1 as const,
      common: { tools: ["search"], skills: [] },
      subroles: [
        {
          id: "analyst",
          name: "Аналитик",
          description: "Исследования",
          enabled: true,
          capabilities: { tools: ["analytics"], skills: [] },
        },
      ],
    },
    systemRequired: { tools: [], skills: [] },
    catalog: [
      {
        type: "tool" as const,
        id: "search",
        title: "search",
        source: { kind: "core" as const },
        status: "available" as const,
      },
      {
        type: "tool" as const,
        id: "analytics",
        title: "analytics",
        source: { kind: "plugin" as const, name: "analytics" },
        status: "available" as const,
      },
    ],
    users: [],
    audit: [],
  };
  return {
    current: vi.fn(),
    session: vi.fn(),
    admin: vi.fn(async () => ({ ok: true as const, value: snapshot })),
    createSubrole: vi.fn(),
    updateSubrole: vi.fn(),
    deleteSubrole: vi.fn(),
    updateCommon: vi.fn(async (_token, input) => ({
      ok: true as const,
      value: input,
    })),
    updateAssignment: vi.fn(),
  };
}

describe("QA administration", () => {
  it("renders roles and the separate common capability editor", async () => {
    render(
      <QaAdmin
        api={api()}
        token="admin-token"
        routePath="/qa"
        onPreview={() => undefined}
      />,
    );
    expect(await screen.findByText("Аналитик")).toBeTruthy();
    expect(screen.getByText("1 инструментов")).toBeTruthy();
    fireEvent.click(screen.getByText("Общие возможности"));
    await waitFor(() => expect(screen.getByText("search")).toBeTruthy());
    expect(
      (screen.getByRole("checkbox", { name: /search/u }) as HTMLInputElement)
        .checked,
    ).toBe(true);
  });
});
