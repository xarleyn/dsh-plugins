import { describe, expect, it } from "vitest";
import { listenerCollector } from "../src/index";

describe("listenerCollector", () => {
  it("returns the first registered listener of an event", () => {
    const collector = listenerCollector();
    collector.on("gate/allow", () => "first");
    collector.on("gate/allow", () => "second");

    const handler = collector.handler("gate/allow");
    expect(handler()).toBe("first");
    expect(collector.count("gate/allow")).toBe(2);
  });

  it("counts events independently and reports zero for unknown names", () => {
    const collector = listenerCollector();

    expect(collector.count("missing")).toBe(0);

    collector.on("a", () => undefined);
    collector.on("b", () => undefined);
    collector.on("b", () => undefined);

    expect(collector.count("a")).toBe(1);
    expect(collector.count("b")).toBe(2);
  });

  it("throws when an event has no listener", () => {
    const collector = listenerCollector();

    expect(() => collector.handler("gate/allow")).toThrow(
      "no listener for gate/allow",
    );
  });

  it("unsubscribes the exact listener it returned", () => {
    const collector = listenerCollector();
    const first = (): void => undefined;
    const second = (): void => undefined;

    const offFirst = collector.on("event", first);
    collector.on("event", second);

    offFirst();
    expect(collector.count("event")).toBe(1);
    expect(collector.handler("event")).toBe(second);

    offFirst();
    expect(collector.count("event")).toBe(1);
  });

  it("accepts and ignores the options argument", () => {
    const collector = listenerCollector();

    expect(
      collector.on("event", () => undefined, { prepend: true }),
    ).toBeTypeOf("function");
    expect(collector.count("event")).toBe(1);
  });
});
