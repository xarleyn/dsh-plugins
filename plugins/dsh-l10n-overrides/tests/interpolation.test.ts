import { describe, expect, it } from "vitest";
import { interpolate } from "../src/runtime/interpolate.js";

describe("interpolate", () => {
  it("returns the template unchanged when parameters are omitted", () => {
    expect(interpolate("Hello, {name}!")).toBe("Hello, {name}!");
  });

  it("replaces word placeholders with known primitive values", () => {
    expect(
      interpolate("{name} has {count} items; enabled={enabled}; {not-a-word}", {
        name: "Ada",
        count: 3,
        enabled: false,
        "not-a-word": "unchanged",
      }),
    ).toBe("Ada has 3 items; enabled=false; {not-a-word}");
  });

  it("preserves placeholders that have no matching parameter", () => {
    expect(interpolate("Hello, {name}.", {})).toBe("Hello, {name}.");
  });

  it("preserves placeholders for nullish parameter values", () => {
    expect(
      interpolate("{nil} and {unset}", { nil: null, unset: undefined }),
    ).toBe("{nil} and {unset}");
  });

  it("does not substitute inherited parameter properties", () => {
    const params = Object.create({ inherited: "unsafe" }) as Record<
      string,
      unknown
    >;
    params.own = "safe";

    expect(interpolate("{own} {inherited}", params)).toBe("safe {inherited}");
  });

  it("uses safe string conversion for symbol and object values", () => {
    expect(
      interpolate("{symbol} {object}", {
        symbol: Symbol("token"),
        object: { toString: () => "converted" },
      }),
    ).toBe("Symbol(token) converted");
  });

  it("preserves a placeholder when value string conversion throws", () => {
    const throwing = {
      toString(): string {
        throw new Error("conversion failed");
      },
    };

    expect(() =>
      interpolate("before {value} after", { value: throwing }),
    ).not.toThrow();
    expect(interpolate("before {value} after", { value: throwing })).toBe(
      "before {value} after",
    );
  });

  it("preserves a placeholder when an own accessor throws during property access", () => {
    const params = Object.defineProperty({}, "value", {
      enumerable: true,
      get(): never {
        throw new Error("property access failed");
      },
    }) as Record<string, unknown>;
    let result = "";

    expect(() => {
      result = interpolate("before {value} after", params);
    }).not.toThrow();
    expect(result).toBe("before {value} after");
  });

  it("preserves a placeholder when the has-own proxy trap throws", () => {
    const params = new Proxy<Record<string, unknown>>(
      {},
      {
        getOwnPropertyDescriptor(): never {
          throw new Error("descriptor access failed");
        },
      },
    );
    let result = "";

    expect(() => {
      result = interpolate("before {value} after", params);
    }).not.toThrow();
    expect(result).toBe("before {value} after");
  });
});
