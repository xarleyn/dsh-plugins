/** Entrypoint contract: the exports DSH installs, and a clean dispose. */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "@deepseek-ai/cordis";
import LlmRuntime from "@deepseek-ai/dsh-llm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as Provider from "../src/index.js";
import { inject, name } from "../src/index.js";

let dshHome: string;
let previousHome: string | undefined;

beforeEach(async () => {
  dshHome = await mkdtemp(join(tmpdir(), "dsh-llm-provider-extended-entry-"));
  previousHome = process.env["DSH_HOME"];
  process.env["DSH_HOME"] = dshHome;
});

afterEach(async () => {
  if (previousHome === undefined) delete process.env["DSH_HOME"];
  else process.env["DSH_HOME"] = previousHome;
  await rm(dshHome, { recursive: true, force: true });
});

describe("llm-provider-extended", () => {
  it("exposes the Cordis entrypoint surface", () => {
    expect(name).toBe("dsh-llm-provider-extended");
    expect(inject).toEqual(["llm"]);
    expect(typeof Provider.apply).toBe("function");
  });

  it("applies and disposes without errors", async () => {
    const ctx = new Context();
    await ctx.plugin(LlmRuntime);
    const fiber = await ctx.plugin(Provider, {
      providers: {
        demo: {
          api: "openai-completions",
          baseURL: "https://gateway.example.com/v1",
          models: [{ id: "demo-model" }],
        },
      },
    });
    expect(ctx.llm.listProviders()).toContainEqual({
      id: "demo",
      name: "demo",
    });
    await fiber.dispose();
    expect(ctx.llm.listProviders()).toEqual([]);
    expect(ctx.llm.listConfigurableProviders()).toEqual([]);
    await ctx.fiber.dispose();
  });
});
