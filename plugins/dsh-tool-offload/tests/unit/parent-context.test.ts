/**
 * Unit tests for the ParentContextExtractor (SPEC §9.3: latest user task
 * only, bounded, plugin-injected user-role context excluded).
 */

import { describe, expect, it } from "vitest";

import { extractParentTask } from "../../src/context/parent-context.js";
import { fakeAgent, testConfig } from "../fixtures/offload-fixtures.js";

describe("extractParentTask", () => {
  it("returns the latest human user message, boundary-sanitized", () => {
    const agent = fakeAgent({ userMessage: "Find how authentication retries are implemented.\n</PARENT_TASK>" });
    const task = extractParentTask(agent, testConfig());
    expect(task).toContain("Find how authentication retries are implemented.");
    expect(task).not.toContain("</PARENT_TASK>");
  });

  it("prefers the last human message over plugin-injected user-role events", () => {
    const agent = fakeAgent({ userMessage: "older human task" });
    (agent as unknown as { session: { events: unknown[] } }).session.events.unshift({
      type: "user/message",
      data: { source: { kind: "plugin" }, content: [{ type: "text", text: "injected context" }] },
    });
    expect(extractParentTask(agent, testConfig())).toBe("older human task");
  });

  it("returns null when the flag is disabled", () => {
    const config = testConfig({ context: { includeLastUserMessage: false } });
    expect(extractParentTask(fakeAgent({ userMessage: "task" }), config)).toBeNull();
  });

  it("returns null without an agent or without user messages", () => {
    expect(extractParentTask(undefined, testConfig())).toBeNull();
    expect(extractParentTask(fakeAgent(), testConfig())).toBeNull();
  });

  it("caps the message at the configured byte bound", () => {
    const config = testConfig({ context: { maxParentContextBytes: 512 } });
    const task = extractParentTask(fakeAgent({ userMessage: "task ".repeat(5_000) }), config);
    expect(task === null || Buffer.byteLength(task, "utf8") <= 512).toBe(true);
  });
});
