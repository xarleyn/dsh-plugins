// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { QaFileAttachment } from "../../../src/client/components/QaFileAttachment.js";

afterEach(cleanup);
describe("document approval action", () => {
  it("requires a human click and does not send a second approval while pending", async () => {
    let settle: () => void = () => {};
    const approve = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    render(
      <QaFileAttachment
        name="proposal.md"
        bytes={100}
        tone="sent"
        onApprove={approve}
      />,
    );
    expect(approve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("qa-file-approve"));
    expect(approve).toHaveBeenCalledTimes(1);
    expect(
      (screen.getByTestId("qa-file-approve") as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByTestId("qa-file-approve"));
    expect(approve).toHaveBeenCalledTimes(1);
    settle();
    await waitFor(() =>
      expect(screen.getByTestId("qa-file-approve").textContent).toBe(
        "Согласовано",
      ),
    );
  });
  it("reports a stale/refused approval instead of showing it as agreed", async () => {
    const approve = vi.fn(async () => {
      throw new Error("stale revision");
    });
    render(
      <QaFileAttachment
        name="proposal.md"
        bytes={100}
        tone="sent"
        onApprove={approve}
      />,
    );
    fireEvent.click(screen.getByTestId("qa-file-approve"));
    await waitFor(() =>
      expect(screen.getByTestId("qa-file-approval-error")).toBeTruthy(),
    );
    expect(screen.getByTestId("qa-file-approve").textContent).toContain(
      "Согласовать",
    );
  });
});
