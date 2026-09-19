import { describe, expect, it } from "vitest";
import { qaKioskDeployment } from "../src/ui-mode.js";

describe("qaKioskDeployment", () => {
  it("is true for the qa UI mode", () => {
    expect(qaKioskDeployment({ DSH_UI_MODE: "qa" })).toBe(true);
  });

  it("tolerates surrounding whitespace", () => {
    expect(qaKioskDeployment({ DSH_UI_MODE: " qa " })).toBe(true);
  });

  it.each([undefined, "", "default", "embedded", "kiosk", "QA"])(
    "is false for %s",
    (value) => {
      expect(qaKioskDeployment({ DSH_UI_MODE: value })).toBe(false);
    },
  );
});
