import { describe, expect, it } from "vitest";
import { fixedClock } from "../src/index";

describe("fixedClock", () => {
  it("advances by the default step from the default start", () => {
    const clock = fixedClock();

    expect(clock()).toBe(1_700_000_001_000);
    expect(clock()).toBe(1_700_000_002_000);
    expect(clock()).toBe(1_700_000_003_000);
  });

  it("honors a custom start and step", () => {
    const clock = fixedClock(100, 10);

    expect(clock()).toBe(110);
    expect(clock()).toBe(120);
  });

  it("keeps the reading constant with a zero step", () => {
    const clock = fixedClock(100, 0);

    expect(clock()).toBe(100);
    expect(clock()).toBe(100);
  });

  it("lets a test jump the reading and keeps stepping from there", () => {
    const clock = fixedClock(100, 0);

    clock.set(145);
    expect(clock()).toBe(145);

    clock.set(170);
    expect(clock()).toBe(170);

    const stepping = fixedClock(0, 1_000);
    stepping.set(5_000);
    expect(stepping()).toBe(6_000);
  });
});
