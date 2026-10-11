/** Entrypoint contract: the exports DSH installs, and a clean dispose. */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Context } from "@deepseek-ai/cordis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apply, inject, name, TOOL_NAMES } from "../src/index.js";

let dshHome: string;
let previousHome: string | undefined;

beforeEach(async () => {
  dshHome = await mkdtemp(join(tmpdir(), "dsh-decision-tools-entry-"));
  previousHome = process.env["DSH_HOME"];
  process.env["DSH_HOME"] = dshHome;
});

afterEach(async () => {
  if (previousHome === undefined) delete process.env["DSH_HOME"];
  else process.env["DSH_HOME"] = previousHome;
  await rm(dshHome, { recursive: true, force: true });
});

function makeContext(): Context {
  const logger = () => {};
  return {
    logger: { debug: logger, info: logger, warn: logger, error: logger },
    tools: { register: () => () => {} },
  } as unknown as Context;
}

describe("decision-tools", () => {
  it("exposes the Cordis entrypoint surface", () => {
    expect(name).toBe("dsh-decision-tools");
    expect(inject).toEqual(["tools"]);
    expect(typeof apply).toBe("function");
  });

  it("applies and disposes without errors", async () => {
    const dispose = apply(makeContext(), {});
    expect(dispose).toBeTypeOf("function");
    await expect(dispose()).resolves.toBeUndefined();
  });

  it("registers all six tools and removes them exactly once on disposal", async () => {
    const ctx = makeContext();
    const removers = TOOL_NAMES.map(() => vi.fn());
    const register = vi
      .fn()
      .mockImplementation(() => removers[register.mock.calls.length - 1]);
    ctx.tools.register = register;
    const dispose = apply(ctx);
    expect(register.mock.calls.map(([tool]) => tool.name)).toEqual([
      ...TOOL_NAMES,
    ]);
    await dispose();
    await dispose();
    for (const remove of removers) expect(remove).toHaveBeenCalledTimes(1);
  });

  it("registers no tools when disabled", async () => {
    const ctx = makeContext();
    const register = vi.fn();
    ctx.tools.register = register;
    await apply(ctx, { enabled: false })();
    expect(register).not.toHaveBeenCalled();
  });

  it("removes earlier registrations when applying the plugin fails", () => {
    const ctx = makeContext();
    const remove = vi.fn();
    ctx.tools.register = vi
      .fn()
      .mockImplementationOnce(() => remove)
      .mockImplementationOnce(() => {
        throw new Error("registration failed");
      });
    expect(() => apply(ctx)).toThrow("registration failed");
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
