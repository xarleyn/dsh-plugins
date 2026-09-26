import { describe, expect, it } from "vitest";
import {
  DEFAULT_QA_SURFACE_CONFIG,
  resolveConfig,
} from "../../src/resolve-config.js";

describe("notifications config", () => {
  it("keeps both channels available on a stand that says nothing", () => {
    const config = resolveConfig({});
    expect(config.notifications).toEqual({ enabled: true, allowOs: true });
    expect(config.notifications).toEqual(
      DEFAULT_QA_SURFACE_CONFIG.notifications,
    );
  });

  it("takes the deployment's switches apart", () => {
    expect(
      resolveConfig({ notifications: { enabled: false } }).notifications,
    ).toEqual({ enabled: false, allowOs: true });
    expect(
      resolveConfig({ notifications: { allowOs: false } }).notifications,
    ).toEqual({ enabled: true, allowOs: false });
  });

  it("freezes the resolved slice", () => {
    expect(Object.isFrozen(resolveConfig({}).notifications)).toBe(true);
  });
});
