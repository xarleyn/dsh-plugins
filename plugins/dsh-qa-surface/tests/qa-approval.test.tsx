// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QaApproval } from "../src/client/components/QaApproval.js";
import type { QaPendingApproval } from "../src/types.js";

const REQUEST: QaPendingApproval = {
  id: "request-1",
  sessionId: "s1",
  toolName: "glob",
  reason: "Safety gate requests approval",
  createdAt: 1,
  delegated: false,
};

describe("QA approval card", () => {
  it("stays out of the layout while nothing is parked", () => {
    const { container } = render(
      <QaApproval approvals={[]} onAnswer={vi.fn(async () => undefined)} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the gate's own reason and the tool behind it", () => {
    render(
      <QaApproval
        approvals={[REQUEST]}
        onAnswer={vi.fn(async () => undefined)}
      />,
    );
    expect(screen.getByText("Ожидает одобрения")).toBeDefined();
    expect(screen.getByText("Safety gate requests approval")).toBeDefined();
    expect(screen.getByText("glob")).toBeDefined();
  });

  it("answers once and disables the row while the Host works", async () => {
    let release: () => void = () => undefined;
    const onAnswer = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    render(<QaApproval approvals={[REQUEST]} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByText("Разрешить один раз"));
    expect(onAnswer).toHaveBeenCalledWith("request-1", "allowed-once");
    expect(screen.getByText("Отклонить")).toHaveProperty("disabled", true);
    release();
    await waitFor(() => {
      expect(screen.getByText("Отклонить")).toHaveProperty("disabled", false);
    });
  });

  it("marks a request that came from a delegated child", () => {
    const { container } = render(
      <QaApproval
        approvals={[{ ...REQUEST, delegated: true }]}
        onAnswer={vi.fn(async () => undefined)}
      />,
    );
    const mark = screen.getByText("запросил субагент");
    // The mark is its own span, not a dot-glued suffix of the tool name.
    expect(mark.className).toBe("dsh-qa-approval__delegated");
    expect(container.textContent).not.toContain("·");
  });

  it("leaves the delegation mark off a plain request", () => {
    const { container } = render(
      <QaApproval
        approvals={[REQUEST]}
        onAnswer={vi.fn(async () => undefined)}
      />,
    );
    expect(screen.queryByText("запросил субагент")).toBeNull();
    expect(container.querySelector(".dsh-qa-approval__delegated")).toBeNull();
  });

  it("answers the refusal from the other button", async () => {
    const onAnswer = vi.fn(async () => undefined);
    render(<QaApproval approvals={[REQUEST]} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByText("Отклонить"));
    expect(onAnswer).toHaveBeenCalledWith("request-1", "rejected");
    await waitFor(() => {
      expect(screen.getByText("Отклонить")).toHaveProperty("disabled", false);
    });
  });
});
