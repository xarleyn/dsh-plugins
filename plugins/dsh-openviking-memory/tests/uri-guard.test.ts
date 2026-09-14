/**
 * The `viking://` guard: OpenViking URIs are virtual database paths, so handing
 * one to a filesystem or shell tool is always a mistake and the call is denied
 * with a hint naming the OpenViking tool that owns them.
 *
 * The guard is independent of the injection controls (SPEC §22.3): the same
 * `tools/pre-execute` listener is registered in every mode, so the last tests
 * here build a harness with `autoInject: false` and expect the same denial.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { guardVikingUri, type VikingUriDecision } from "../src/uri-guard.js";
import { createHarness, emit, type Harness } from "./helpers/harness.js";

const FIRST_LINE =
  "viking:// URIs are OpenViking virtual paths, not local filesystem paths.";

/** A URI in the shape the model would produce for a stored memory. */
const MEMORY_URI = "viking://user/default/memories/profile.md";

/** Narrow a decision to its denial variant, failing loudly on an allow. */
function requireDeny(decision: VikingUriDecision): {
  readonly kind: "deny";
  readonly reason: string;
} {
  if (decision.kind !== "deny")
    throw new Error(`expected a denial, got ${decision.kind}`);
  return decision;
}

/**
 * A `next` spy that returns one sentinel decision object, so a delegation can
 * be asserted with `toBe` — "the identical value came back", not "an equal one".
 */
function spyNext(): {
  readonly sentinel: VikingUriDecision;
  readonly next: () => Promise<VikingUriDecision>;
} {
  const sentinel: VikingUriDecision = { kind: "allow" };
  const next = vi.fn(async (): Promise<VikingUriDecision> => sentinel);
  return { sentinel, next };
}

describe("guarded tool names", () => {
  const DENIED: readonly {
    readonly name: string;
    readonly args: Record<string, unknown>;
    /** The exact tail of the `Use … instead.` line. */
    readonly tool: string;
  }[] = [
    {
      name: "read",
      args: { file_path: MEMORY_URI },
      tool: "mcp__openviking__read",
    },
    {
      name: "glob",
      args: { path: "viking://user/default/memories" },
      tool: "mcp__openviking__list",
    },
    {
      name: "grep",
      args: { path: "viking://user/default/memories", pattern: "profile" },
      tool: "mcp__openviking__grep",
    },
    {
      name: "bash",
      args: { command: `cat ${MEMORY_URI}` },
      tool: "mcp__openviking__read or mcp__openviking__search",
    },
    {
      name: "edit",
      args: { file_path: MEMORY_URI },
      tool: "mcp__openviking__edit",
    },
    {
      name: "write",
      args: { file_path: MEMORY_URI },
      tool: "mcp__openviking__write",
    },
    {
      name: "str_replace_editor",
      args: { command: "view", path: MEMORY_URI },
      tool: "the OpenViking MCP tools",
    },
  ];

  it.each(DENIED)(
    "denies $name and points at $tool",
    async ({ name, args, tool }) => {
      const { next } = spyNext();

      const denial = requireDeny(
        await guardVikingUri({ name, arguments: args }, next),
      );

      expect(next).not.toHaveBeenCalled();
      expect(denial.reason.startsWith(FIRST_LINE)).toBe(true);
      expect(denial.reason.split("\n")[1]).toBe(`Use ${tool} instead.`);
      expect(denial.reason).toMatch(/\nExample: /);
    },
  );

  it("names the OpenViking tool in the example line for each guarded tool", async () => {
    const { next } = spyNext();

    const read = requireDeny(
      await guardVikingUri(
        { name: "read", arguments: { file_path: MEMORY_URI } },
        next,
      ),
    );
    expect(read.reason).toContain(
      `Example: mcp__openviking__read(uris="${MEMORY_URI}")`,
    );

    const glob = requireDeny(
      await guardVikingUri(
        { name: "glob", arguments: { path: "viking://user/default/memories" } },
        next,
      ),
    );
    expect(glob.reason).toContain(
      'Example: mcp__openviking__list(uri="viking://user/default/memories")',
    );

    const grep = requireDeny(
      await guardVikingUri(
        { name: "grep", arguments: { path: MEMORY_URI, pattern: "profile" } },
        next,
      ),
    );
    expect(grep.reason).toContain(
      `Example: mcp__openviking__grep(pattern="profile", uri="${MEMORY_URI}")`,
    );

    const write = requireDeny(
      await guardVikingUri(
        { name: "write", arguments: { file_path: MEMORY_URI } },
        next,
      ),
    );
    expect(write.reason).toContain(
      `Example: mcp__openviking__write(uri="${MEMORY_URI}", content="...")`,
    );
  });
});

describe("delegation", () => {
  it("passes a non-guarded tool name through untouched", async () => {
    const { sentinel, next } = spyNext();

    const decision = await guardVikingUri(
      { name: "todo_write", arguments: { items: [] } },
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(decision).toBe(sentinel);
  });

  it("never shadows the bridged OpenViking tools", async () => {
    const { sentinel, next } = spyNext();

    for (const raw of ["read", "grep", "glob", "write", "edit"]) {
      const decision = await guardVikingUri(
        { name: `mcp__openviking__${raw}`, arguments: { uri: MEMORY_URI } },
        next,
      );
      expect(decision, raw).toBe(sentinel);
    }
    expect(next).toHaveBeenCalledTimes(5);
  });

  it("passes a guarded tool with an ordinary filesystem path through", async () => {
    const { sentinel, next } = spyNext();

    const decision = await guardVikingUri(
      { name: "read", arguments: { file_path: "/tmp/a" } },
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(decision).toBe(sentinel);
  });
});

// A `viking://` URI that appears in file CONTENT is not a location: scanning
// every argument value denied a local `write` whose body merely mentioned a
// viking path, and no file was created.
describe("content is not a location", () => {
  const ALLOWED: readonly (readonly [string, Record<string, unknown>])[] = [
    [
      "write",
      {
        file_path: "notes.md",
        content: "see viking://user/default/memories/x",
      },
    ],
    [
      "write",
      {
        file_path: "/home/me/notes.md",
        content: "docs say viking://user/default/ is virtual",
      },
    ],
    [
      "edit",
      {
        file_path: "/home/me/notes.md",
        old_string: "old",
        new_string: "see viking://user/default/memories/",
      },
    ],
    [
      "str_replace_editor",
      {
        command: "create",
        path: "/tmp/notes.md",
        file_text: "viking://user/default/",
      },
    ],
  ];

  it.each(ALLOWED)(
    "allows %s whose content mentions a viking URI",
    async (name, args) => {
      const { sentinel, next } = spyNext();

      const decision = await guardVikingUri({ name, arguments: args }, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(decision).toBe(sentinel);
    },
  );
});

describe("a viking URI used as a location is still denied", () => {
  const DENIED: readonly (readonly [string, Record<string, unknown>])[] = [
    ["read", { file_path: "/tmp/x", uri: "viking://~/memories/a" }],
    ["read", { paths: ["/a", "viking://~/skills/s"] }],
    ["write", { file_path: MEMORY_URI, content: "harmless text" }],
    ["edit", { file_path: MEMORY_URI, old_string: "a", new_string: "b" }],
    // A path key the key list does not know about is still swept.
    ["glob", { targets: { primary: "viking://user/default/memories" } }],
    // bash carries its path inside `command`, which is not content.
    ["bash", { command: `cat ${MEMORY_URI}` }],
  ];

  it.each(DENIED)("denies %s", async (name, args) => {
    const { next } = spyNext();

    const denial = requireDeny(
      await guardVikingUri({ name, arguments: args }, next),
    );

    expect(next).not.toHaveBeenCalled();
    expect(denial.reason.startsWith(FIRST_LINE)).toBe(true);
  });
});

describe("the wired listener", () => {
  let harness: Harness | undefined;

  afterEach(async () => {
    await harness?.dispose();
    harness = undefined;
  });

  it("denies through tools/pre-execute", async () => {
    harness = await createHarness({});
    const { next } = spyNext();

    const decision = (await emit(
      harness,
      "tools/pre-execute",
      { name: "read", arguments: { file_path: MEMORY_URI } },
      next,
    )) as VikingUriDecision;

    expect(next).not.toHaveBeenCalled();
    const denial = requireDeny(decision);
    expect(denial.reason.startsWith(FIRST_LINE)).toBe(true);
    expect(denial.reason).toContain("mcp__openviking__read");
  });

  it("denies the same URI with autoInject:false, where nothing is injected at all", async () => {
    harness = await createHarness({ autoInject: false });
    const { next } = spyNext();

    expect(harness.plugin.injection).toEqual({
      startupProfile: false,
      stepProfile: false,
      recall: false,
    });

    const decision = (await emit(
      harness,
      "tools/pre-execute",
      { name: "glob", arguments: { path: "viking://user/default/memories" } },
      next,
    )) as VikingUriDecision;

    expect(next).not.toHaveBeenCalled();
    const denial = requireDeny(decision);
    expect(denial.reason.startsWith(FIRST_LINE)).toBe(true);
    expect(denial.reason.split("\n")[1]).toBe(
      "Use mcp__openviking__list instead.",
    );
  });
});
