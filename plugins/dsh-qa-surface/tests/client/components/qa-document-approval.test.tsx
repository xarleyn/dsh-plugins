// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { QaFileAttachment } from "../../../src/client/components/QaFileAttachment.js";

afterEach(cleanup);
describe("document approval action", () => {
  it("does not present an unreported artifact size as an empty file", () => {
    const view = render(
      <QaFileAttachment name="draft-9.md" bytes={null} tone="sent" />,
    );
    expect(screen.getByTestId("qa-file-name").textContent).toBe("draft-9.md");
    expect(screen.queryByTestId("qa-file-size")).toBeNull();
    view.rerender(<QaFileAttachment name="empty.md" bytes={0} tone="sent" />);
    expect(screen.getByTestId("qa-file-size").textContent).toBe("0 Б");
  });

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
