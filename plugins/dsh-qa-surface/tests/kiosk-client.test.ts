import { describe, expect, it } from "vitest";
import {
  matchesSurface,
  qaKioskBasePath,
  qaKioskMode,
} from "../src/client/kiosk.js";

describe("surface matching", () => {
  // The matching contract the kiosk relies on, spelled out: the surface path
  // itself, its trailing-slash form, and every child are on the surface; a
  // plain prefix is not.
  it.each(["/qa", "/qa/", "/qa/run/1", "/qa/whatever"])(
    "matchesSurface %s on /qa",
    (pathname) => {
      expect(matchesSurface(pathname, "/qa")).toBe(true);
    },
  );

  it.each(["/", "/qadmin", "/qa-test", "/qaaaa", "/api/qa"])(
    "matchesSurface %s off /qa",
    (pathname) => {
      expect(matchesSurface(pathname, "/qa")).toBe(false);
    },
  );
});

describe("qaKioskMode", () => {
  it("reads the prelude-published global", () => {
    expect(qaKioskMode({ DSH_UI_MODE: "qa" })).toBe(true);
  });

  it.each([
    ["overlay deployment without the global", {}],
    ["host without the kiosk patches", { DSH_UI_MODE: undefined }],
    ["another surface mode", { DSH_UI_MODE: "embedded" }],
    ["a value of the wrong type", { DSH_UI_MODE: 42 }],
  ])("is false for %s", (_name, target) => {
    expect(qaKioskMode(target)).toBe(false);
  });
});

describe("qaKioskBasePath", () => {
  it("defaults to /qa without a published base path", () => {
    expect(qaKioskBasePath({})).toBe("/qa");
  });

  it("reads a published base path", () => {
    expect(qaKioskBasePath({ DSH_QA_BASE_PATH: "/surface" })).toBe("/surface");
  });

  it.each([
    ["empty", ""],
    ["no leading slash", "qa"],
    ["trailing slash", "/qa/"],
    ["wrong type", 7],
  ])("falls back to /qa for a %s value", (_name, value) => {
    expect(qaKioskBasePath({ DSH_QA_BASE_PATH: value as never })).toBe("/qa");
  });
});
