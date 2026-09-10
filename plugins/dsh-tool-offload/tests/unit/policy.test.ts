/**
 * Unit tests for the deterministic RoutingPolicy (SPEC §10, §31; §32.1
 * routing matrix).
 */

import { describe, expect, it } from "vitest";

import { resolveToolOffloadConfig } from "../../src/config.js";
import { decideRoute } from "../../src/routing/policy.js";
import { inspectResult } from "../../src/routing/inspect-result.js";
import { fakeExec, successResult, makeText, testConfig } from "../fixtures/offload-fixtures.js";

function candidateFor(tool: string, bytes: number) {
  return inspectResult(fakeExec(tool), successResult(makeText(bytes)));
}

describe("decideRoute (SPEC §32.1 routing matrix)", () => {
  it("offloads an allowed tool with a large textual result", () => {
    const decision = decideRoute(candidateFor("read", 4_096), testConfig());
    expect(decision).toEqual({ kind: "offload", worker: "default", prompt: "code-reader" });
  });

  it("passes small results through as below-threshold", () => {
    const decision = decideRoute(candidateFor("read", 32), testConfig());
    expect(decision).toEqual({ kind: "passthrough", reason: "below-threshold" });
  });

  it("passes denied tools through before the allowlist", () => {
    const config = testConfig({ routing: { allow: ["bash"], deny: ["bash"] } });
    const decision = decideRoute(candidateFor("bash", 4_096), config);
    expect(decision).toEqual({ kind: "passthrough", reason: "tool-denied" });
  });

  it("passes tools outside the allowlist through as tool-not-allowed", () => {
    const decision = decideRoute(candidateFor("custom_workspace_tool", 4_096), testConfig());
    expect(decision).toEqual({ kind: "passthrough", reason: "tool-not-allowed" });
  });

  it("offloads everything textual in denylist mode except denied tools", () => {
    const config = testConfig({ routing: { mode: "denylist", deny: ["bash"] } });
    expect(decideRoute(candidateFor("notebook_read", 4_096), config)).toEqual({
      kind: "offload",
      worker: "default",
      prompt: "generic",
    });
    expect(decideRoute(candidateFor("bash", 4_096), config)).toEqual({ kind: "passthrough", reason: "tool-denied" });
  });

  it("never offloads bash by default (SPEC §10.3)", () => {
    const decision = decideRoute(candidateFor("bash", 400_000), resolveToolOffloadConfig({}));
    expect(decision).toEqual({ kind: "passthrough", reason: "tool-denied" });
  });

  it("passes results above the payload bound through as payload-too-large", () => {
    const config = testConfig({ payload: { maxBytes: 2_048 } });
    const decision = decideRoute(candidateFor("read", 4_096), config);
    expect(decision).toEqual({ kind: "passthrough", reason: "payload-too-large" });
  });

  it("maps built-in prompt profiles per tool family (SPEC §42)", () => {
    expect(decideRoute(candidateFor("grep", 4_096), testConfig())).toMatchObject({ prompt: "search-results" });
    expect(decideRoute(candidateFor("web_fetch", 4_096), testConfig())).toMatchObject({ prompt: "web-reader" });
    expect(decideRoute(candidateFor("read", 4_096), testConfig())).toMatchObject({ prompt: "code-reader" });
    const denyAllMode = testConfig({ routing: { mode: "denylist" } });
    expect(decideRoute(candidateFor("mcp__docs_lookup", 4_096), denyAllMode)).toMatchObject({ prompt: "generic" });
  });
});

describe("decideRoute rules (SPEC §16)", () => {
  it("lets the first matching user rule win over built-ins", () => {
    const config = testConfig({
      workers: { tiny: {} },
      routing: {
        rules: [{ id: "tiny-reads", match: { tools: ["read"] }, worker: "tiny", prompt: "logs" }],
      },
    });
    const decision = decideRoute(candidateFor("read", 4_096), config);
    expect(decision).toEqual({ kind: "offload", worker: "tiny", prompt: "logs" });
  });

  it("treats rules as terminal passthrough when action is passthrough", () => {
    const config = testConfig({
      routing: { rules: [{ id: "keep-raw", match: { tools: ["read"] }, action: "passthrough" }] },
    });
    expect(decideRoute(candidateFor("read", 4_096), config)).toEqual({ kind: "passthrough", reason: "rule-passthrough" });
  });

  it("skips rules whose byte floor is not met and falls through to later rules", () => {
    const config = testConfig({
      workers: { tiny: {} },
      routing: {
        rules: [
          { id: "huge-only", match: { tools: ["read"], minBytes: 100_000 }, worker: "tiny" },
          { id: "all-reads", match: { tools: ["read"] }, prompt: "code-reader" },
        ],
      },
    });
    expect(decideRoute(candidateFor("read", 2_048), config)).toEqual({
      kind: "offload",
      worker: "default",
      prompt: "code-reader",
    });
    expect(decideRoute(candidateFor("read", 128_000), config)).toMatchObject({ worker: "tiny" });
  });

  it("ignores rules whose tool set does not match", () => {
    const config = testConfig({
      routing: { rules: [{ id: "web-only", match: { tools: ["web_fetch"] }, action: "passthrough" }] },
    });
    expect(decideRoute(candidateFor("read", 4_096), config)).toMatchObject({ kind: "offload" });
  });
});
