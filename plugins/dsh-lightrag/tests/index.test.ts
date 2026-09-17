/** Plugin entry tests: registration surface, switches, re-apply (SPEC §4.3). */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  apply,
  Config,
  createLightRagClient,
  inject,
  LIGHTRAG_TOOL_NAMES,
  LIGHTRAG_WRITE_TOOL_NAMES,
  LightRagConfigSchema,
  name,
} from "../src/index.js";

let logHome: string;
let previousHome: string | undefined;

beforeEach(async () => {
  logHome = await mkdtemp(join(tmpdir(), "dsh-lightrag-entry-"));
  previousHome = process.env["DSH_HOME"];
  process.env["DSH_HOME"] = logHome;
});

afterEach(async () => {
  if (previousHome === undefined) delete process.env["DSH_HOME"];
  else process.env["DSH_HOME"] = previousHome;
  await rm(logHome, { recursive: true, force: true });
});

function makeHost() {
  const registered: { name: string }[] = [];
  return {
    registered,
    tools: {
      register(definition: unknown) {
        registered.push(definition as { name: string });
        return () => {};
      },
    },
  };
}

describe("dsh-lightrag entry", () => {
  it("identifies itself for the host composition", () => {
    expect(name).toBe("dsh-lightrag");
    expect(inject).toEqual(["tools"]);
    expect(Config).toBe(LightRagConfigSchema);
  });

  it("registers the read tools by default", () => {
    const host = makeHost();
    apply(host, {});
    expect(host.registered.map((tool) => tool.name)).toEqual([
      ...LIGHTRAG_TOOL_NAMES,
    ]);
  });

  it("registers nothing when disabled", () => {
    const host = makeHost();
    apply(host, { enabled: false });
    expect(host.registered).toHaveLength(0);
  });

  it("keeps the write tools out unless writes are enabled", () => {
    const off = makeHost();
    apply(off, {});
    expect(off.registered.map((tool) => tool.name)).not.toContain(
      "dsh_lightrag_delete",
    );

    const on = makeHost();
    apply(on, { writes: { enabled: true } });
    expect(on.registered.map((tool) => tool.name)).toEqual([
      ...LIGHTRAG_TOOL_NAMES,
      ...LIGHTRAG_WRITE_TOOL_NAMES,
    ]);
  });

  it("names every registered tool exactly once", () => {
    const host = makeHost();
    apply(host, { writes: { enabled: true } });
    expect(new Set(host.registered.map((tool) => tool.name)).size).toBe(
      host.registered.length,
    );
  });

  it("supports repeated apply cycles", () => {
    const first = makeHost();
    apply(first, {});
    const second = makeHost();
    apply(second, {
      endpoint: "http://lightrag:9621",
      apiKey: "key",
      timeoutMs: 5_000,
    });
    expect(first.registered).toHaveLength(LIGHTRAG_TOOL_NAMES.length);
    expect(second.registered).toHaveLength(LIGHTRAG_TOOL_NAMES.length);
  });

  it("refuses to apply a configuration that is not a bare origin", () => {
    expect(() =>
      apply(makeHost(), { endpoint: "http://lightrag:9621/api" }),
    ).toThrow(TypeError);
  });

  it("exports the client factory deployments can build on", () => {
    expect(typeof createLightRagClient).toBe("function");
  });
});
