// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { QaRequestWait } from "../../../src/client/components/QaRequestWait.js";
const waiting = {
  limit: 2,
  active: 2,
  full: true,
  managed: true,
  waiting: true,
  position: 1,
  estimatedWaitMs: null,
};
describe("queued turn indicator", () => {
  afterEach(cleanup);
  it("shows the real position without inventing an estimate", () => {
    render(<QaRequestWait status={waiting} />);
    expect(screen.getByRole("status").textContent).toContain(
      "Место в очереди: 1",
    );
    expect(screen.getByRole("status").textContent).not.toContain("Примерное");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("labels a measured estimate as approximate", () => {
    render(<QaRequestWait status={{ ...waiting, estimatedWaitMs: 180000 }} />);
    expect(screen.getByRole("status").textContent).toContain(
      "Примерное ожидание — 3 мин",
    );
  });
  it.each([
    null,
    { ...waiting, waiting: false },
    { limit: 2, active: 2, full: true },
  ])("stays hidden outside server waiting", (status) => {
    render(<QaRequestWait status={status} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
