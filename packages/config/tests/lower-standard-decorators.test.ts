import { describe, expect, it } from "vitest";

import { lowerStandardDecorators } from "@yadsh/dsh-config/vitest";

// The fixture is imported through the preset the package publishes, so this
// suite collects only if `dsh:lower-standard-decorators` really lowered it: the
// bare `SyntaxError: Invalid or unexpected token` of #603 is what a regression
// here prints.
import { decorated, DecoratedHost } from "./fixtures/decorated-host";

interface LoweredSourceMap {
  version: number;
  sources: string[];
  mappings: string;
  sourcesContent?: string[];
}

interface Lowered {
  code: string;
  map?: LoweredSourceMap;
  moduleType?: string;
}

// Rollup types the hook with a plugin context the implementation never reads,
// so the call site states the shape it actually gets back.
type LowerHook = (code: string, id: string) => Lowered | null;

function lower(code: string, fileName: string): Lowered | null {
  const hook = lowerStandardDecorators().transform as unknown as
    LowerHook | undefined;
  if (typeof hook !== "function") {
    throw new Error("the preset must register a plain transform hook");
  }
  return hook(code, fileName);
}

const DECORATED_SOURCE = `export class Store {
  @Remote id(): string {
    return "x";
  }
}
`;

const JSDOC_SOURCE = `/**
 * @param value what to hand back.
 * @returns the value.
 */
export function identity(value: string): string {
  return value;
}
`;

// An `@` that opens its own line without declaring a decorator: the cheap line
// prefilter lets it through, and only the AST gate keeps the module untouched.
const STRING_SOURCE = "export const contact = `\n@example.com\n`;\n";

describe("dsh:lower-standard-decorators", () => {
  it("lowers a decorated module to JavaScript Vite can load", () => {
    const result = lower(DECORATED_SOURCE, "/virtual/DecoratedHost.ts");

    expect(result).not.toBeNull();
    expect(result?.moduleType).toBe("js");
    expect(result?.code).not.toMatch(/^\s*@Remote/m);
    expect(result?.code).toContain("__esDecorate(");
    // The helpers stay inlined, and the module keeps its ESM shape: `importHelpers`
    // would reach for a tslib no plugin depends on, and `module: NodeNext`
    // would emit CommonJS because `transpileModule` cannot see package.json.
    expect(result?.code).not.toContain("tslib");
    expect(result?.code).toContain("export { Store }");
    expect(result?.code).not.toMatch(/\bexports\.|\brequire\(/);
    // `transpileModule` appends an inline map comment; Vite is handed the map
    // itself, so the stale comment has to go.
    expect(result?.code).not.toContain("sourceMappingURL");
  });

  it("returns a source map that points back at the TypeScript source", () => {
    const result = lower(DECORATED_SOURCE, "/virtual/DecoratedHost.ts");
    const map = result?.map;

    expect(map?.version).toBe(3);
    expect(map?.mappings.length).toBeGreaterThan(0);
    expect(map?.sources).toEqual([
      expect.stringMatching(/\/virtual\/DecoratedHost\.ts$/u),
    ]);
    expect(map?.sources[0]).not.toContain("\\");
    expect(map?.sourcesContent?.[0]).toBe(DECORATED_SOURCE);
  });

  it("leaves a module that declares no decorator alone", () => {
    const plain = "export const answer = 42;\n";
    expect(lower(plain, "/virtual/Plain.ts")).toBeNull();
    expect(lower(JSDOC_SOURCE, "/virtual/Documented.ts")).toBeNull();
    expect(lower(STRING_SOURCE, "/virtual/Literal.ts")).toBeNull();
  });

  it("leaves a decorated .tsx alone rather than labelling JSX as js", () => {
    const source = `export const Widget = () => <p>hi</p>;\n${DECORATED_SOURCE}`;

    expect(lower(source, "/virtual/Widget.tsx")).toBeNull();
  });

  it("lowers with standard-decorator semantics, not legacy ones", () => {
    expect(decorated).toHaveLength(1);
    expect(decorated[0]).toMatchObject({
      kind: "method",
      name: "greet",
      isStatic: false,
      hasAddInitializer: true,
    });
    expect(new DecoratedHost().greet("host")).toBe("hello host");
  });
});
