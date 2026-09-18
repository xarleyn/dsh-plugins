import { vi } from "vitest";
import { Diagnostics } from "../src/registry/diagnostics.js";

export function createDiagnostics(): Diagnostics {
  return new Diagnostics({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  });
}

export interface InvalidPackCase {
  readonly name: string;
  readonly intendedId?: string;
  readonly create: () => unknown;
}

export const invalidPackCases: readonly InvalidPackCase[] = [
  {
    name: "an unreadable id",
    create: () =>
      Object.defineProperty({ target: { package: "example" }, en: {} }, "id", {
        enumerable: true,
        get(): never {
          throw new Error("id unavailable");
        },
      }),
  },
  {
    name: "a blank id",
    create: () => ({
      id: "   ",
      target: { package: "example" },
      en: {},
    }),
  },
  {
    name: "an unreadable English dictionary",
    intendedId: "throwing-en",
    create: () =>
      Object.defineProperty(
        { id: "throwing-en", target: { package: "example" } },
        "en",
        {
          enumerable: true,
          get(): never {
            throw new Error("en unavailable");
          },
        },
      ),
  },
  {
    name: "a hostile English dictionary enumeration",
    intendedId: "hostile-en",
    create: () => ({
      id: "hostile-en",
      target: { package: "example" },
      en: new Proxy(
        {},
        {
          ownKeys(): never {
            throw new Error("locale enumeration unavailable");
          },
        },
      ),
    }),
  },
  {
    name: "a hostile namespace dictionary enumeration",
    intendedId: "hostile-namespace",
    create: () => ({
      id: "hostile-namespace",
      target: { package: "example" },
      en: {
        composer: new Proxy(
          {},
          {
            ownKeys(): never {
              throw new Error("namespace enumeration unavailable");
            },
          },
        ),
      },
    }),
  },
  {
    name: "a non-string translation value",
    intendedId: "non-string-value",
    create: () => ({
      id: "non-string-value",
      target: { package: "example" },
      en: { composer: { send: 42 } },
    }),
  },
  {
    name: "an array English dictionary",
    intendedId: "array-en",
    create: () => ({
      id: "array-en",
      target: { package: "example" },
      en: [{ send: "Send" }],
    }),
  },
  {
    name: "an array namespace dictionary",
    intendedId: "array-namespace",
    create: () => ({
      id: "array-namespace",
      target: { package: "example" },
      en: { composer: ["Send"] },
    }),
  },
];
