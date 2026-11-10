/** Entrypoint contract: the exports DSH installs, and a clean dispose. */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Context } from "@deepseek-ai/cordis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apply, inject, name } from "../src/index.js";

let dshHome: string;
let previousHome: string | undefined;

beforeEach(async () => {
  dshHome = await mkdtemp(join(tmpdir(), "dsh-tool-toon-entry-"));
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
    on: vi.fn(() => vi.fn()),
    logger: { debug: logger, info: logger, warn: logger, error: logger },
  } as unknown as Context;
}

describe("tool-toon", () => {
  it("exposes the Cordis entrypoint surface", () => {
    expect(name).toBe("dsh-tool-toon");
    expect(inject).toEqual(["tools"]);
    expect(typeof apply).toBe("function");
  });

  it("applies and disposes without errors", async () => {
    const ctx = makeContext();
    const dispose = apply(ctx, {});
    expect(ctx.on).toHaveBeenCalledWith(
      "tools/post-execute",
      expect.any(Function),
    );
    expect(dispose).toBeTypeOf("function");
    await expect(dispose()).resolves.toBeUndefined();
    expect(vi.mocked(ctx.on).mock.results[0]?.value).toHaveBeenCalledOnce();
  });

  it("does not subscribe when disabled", async () => {
    const ctx = makeContext();
    await apply(ctx, { enabled: false })();
    expect(ctx.on).not.toHaveBeenCalled();
  });
});
