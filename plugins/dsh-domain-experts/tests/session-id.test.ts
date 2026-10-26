import { describe, expect, it } from "vitest";
import { currentSessionId } from "../src/client/session-id.js";

const ctx = (value: unknown) => ({
  sessions: { list: { getSnapshot: () => value } },
});

describe("expert test parent selection", () => {
  it("reads the legacy selected session", () => {
    expect(currentSessionId(ctx({ current: "session-legacy" }))).toBe(
      "session-legacy",
    );
  });
  it("reads the Host 0.2 main view reference while a global panel is open", () => {
    expect(
      currentSessionId(
        ctx({
          byId: {
            "session-selected": { retainedBy: { mainView: 1, gateway: 1 } },
            "session-other": { retainedBy: { gateway: 1 } },
          },
        }),
      ),
    ).toBe("session-selected");
  });
  it("does not use another consumer's chat as the test parent", () => {
    expect(
      currentSessionId(
        ctx({ byId: { "session-other": { retainedBy: { gateway: 1 } } } }),
      ),
    ).toBe("");
  });
  it("refuses ambiguous main view references", () => {
    expect(
      currentSessionId(
        ctx({
          byId: {
            "session-first": { retainedBy: { mainView: 1 } },
            "session-second": { retainedBy: { mainView: 1 } },
          },
        }),
      ),
    ).toBe("");
  });
  it("keeps a missing or unavailable service harmless", () => {
    expect(currentSessionId({})).toBe("");
    expect(
      currentSessionId({
        sessions: {
          list: {
            getSnapshot() {
              throw new Error("not ready");
            },
          },
        },
      }),
    ).toBe("");
  });
});
