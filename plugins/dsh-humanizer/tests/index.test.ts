/** Entrypoint contract: the exports DSH installs, and a clean dispose. */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Context } from "@deepseek-ai/cordis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import plugin, { apply, Config, inject, name } from "../src/index.js";

let dshHome: string;
let previousHome: string | undefined;

beforeEach(async () => {
  dshHome = await mkdtemp(join(tmpdir(), "dsh-humanizer-entry-"));
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

describe("humanizer", () => {
  it("exposes the Cordis entrypoint surface", () => {
    expect(name).toBe("dsh-humanizer");
    expect(inject).toEqual(["tools"]);
    expect(plugin.Config).toBe(Config);
    expect(typeof apply).toBe("function");
  });

  it("applies and disposes without errors", async () => {
    const dispose = apply(makeContext(), {});
    expect(dispose).toBeTypeOf("function");
    await expect(dispose()).resolves.toBeUndefined();
  });

  it("removes both tools once and leaves nothing registered when disabled", async () => {
    const ctx = makeContext();
    const remove = vi.fn();
    const register = vi.fn<Context["tools"]["register"]>(() => remove);
    ctx.tools.register = register;
    const dispose = apply(ctx);
    expect(register.mock.calls.map(([tool]) => tool.name)).toEqual([
      "dsh_humanize_text",
      "dsh_humanizer_status",
    ]);
    await dispose();
    await dispose();
    expect(remove).toHaveBeenCalledTimes(2);
    register.mockClear();
    await apply(ctx, { enabled: false })();
    expect(register).not.toHaveBeenCalled();
  });

  it("rolls back a partially registered plugin", () => {
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
