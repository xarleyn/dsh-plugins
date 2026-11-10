/** Plugin entry tests: registration surface, disable switch, re-apply (SPEC §2). */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apply, Config, GIT_TOOL_NAMES, inject, name } from "../src/index.js";
import { resolveCodeSources } from "@yadsh/dsh-plugin-kit/code-sources";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";

let logHome: string;
let previousHome: string | undefined;

beforeEach(async () => {
  logHome = await mkdtemp(join(tmpdir(), "dsh-git-readonly-entry-"));
  previousHome = process.env["DSH_HOME"];
  process.env["DSH_HOME"] = logHome;
});

afterEach(async () => {
  if (previousHome === undefined) delete process.env["DSH_HOME"];
  else process.env["DSH_HOME"] = previousHome;
  await rm(logHome, { recursive: true, force: true });
});

function makeHost() {
  const registered: unknown[] = [];
  return {
    registered,
    tools: {
      register(definition: unknown) {
        registered.push(definition);
        return () => {};
      },
    },
  };
}

describe("dsh-git-readonly entry", () => {
  it("reads the QA host catalogue lazily from a preset mount", async () => {
    let catalog = resolveCodeSources();
    const host = {
      ...makeHost(),
      get: () => ({ getCodeSources: () => catalog }),
    };
    apply(host);
    const tool = host.registered.find(
      (definition) => (definition as ToolDefinition).name === "dsh_git_sources",
    ) as ToolDefinition;
    catalog = resolveCodeSources({
      entries: [{ id: "shared", label: "Shared", path: "/code/arbitrary" }],
    });
    expect(await tool.execute({}, {} as never)).toMatchObject({
      entries: [expect.objectContaining({ id: "shared" })],
    });
  });
  it("registers provenance tools and source discovery", () => {
    const host = makeHost();
    apply(host, {});
    expect(host.registered).toHaveLength(5);
    expect(
      host.registered.map((tool) => (tool as { name: string }).name),
    ).toEqual([...GIT_TOOL_NAMES]);
  });

  it("registers nothing when disabled", () => {
    const host = makeHost();
    apply(host, { enabled: false });
    expect(host.registered).toHaveLength(0);
  });

  it("supports repeated apply cycles", () => {
    const first = makeHost();
    apply(first, {});
    const second = makeHost();
    apply(second, { timeoutMs: 5_000 });
    expect(first.registered).toHaveLength(5);
    expect(second.registered).toHaveLength(5);
  });

  it("exposes the deployment identity", () => {
    expect(name).toBe("dsh-git-readonly");
    expect(inject).toEqual(["tools"]);
    expect(Config).toBeDefined();
  });
});
