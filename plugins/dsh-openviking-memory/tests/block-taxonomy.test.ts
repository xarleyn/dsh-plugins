/**
 * The block taxonomy at runtime, not at the compiler.
 *
 * `0.1.7-rc.2` did not only rename `ToolResultBlock`: the Host now *emits*
 * `tool-addition` / `tool-removal` blocks, attached to a `developer/message`
 * session event sourced from the `tool-registry` producer
 * (`packages/core/agent-loop/src/agent.ts`). Nothing in this package fails to
 * compile against that, so the two block types are pinned here instead — as
 * things that must never reach memory, never reach a recall query, and never
 * get read as a tool call or a tool result.
 */

import { describe, expect, it } from "vitest";

import { captureEvent, promptText } from "../src/capture.js";
import {
  extractPartsFromPayload,
  extractTextFromPayload,
} from "../src/openviking/capture-utils.js";
import { CONFIG } from "./capture.helpers.js";

const TOOL_CHURN = [
  { type: "tool-addition", toolName: "read" },
  { type: "tool-removal", toolName: "write" },
];

/** One `developer/message` as the agent loop appends it. */
function toolRegistryEvent(): unknown {
  return {
    role: "developer",
    content: TOOL_CHURN,
    source: { kind: "tool-registry" },
  };
}

describe("tool-registry churn never becomes memory", () => {
  it("is not a captured event at all", () => {
    expect(
      captureEvent(
        {
          type: "developer/message",
          time: 1_700_000_000_000,
          data: toolRegistryEvent(),
        },
        CONFIG,
      ),
    ).toBeNull();
  });

  it("adds nothing to the recall query", () => {
    // The query is built from the step's claimed batch; a block the extraction
    // has no rule for must contribute no text, rather than a `[tool-result]`
    // line or a `String(object)` that would retrieve memory with garbage.
    expect(
      promptText([
        {
          role: "user",
          content: [
            { type: "text", text: "what did we decide about the plan?" },
          ],
          source: { kind: "user" },
        } as never,
        toolRegistryEvent() as never,
      ]),
    ).toBe("what did we decide about the plan?");
  });

  it("is neither a tool call nor a tool result to the extractor", () => {
    const message = toolRegistryEvent();

    expect(extractTextFromPayload(message)).toBe("");
    expect(extractPartsFromPayload(message)).toEqual([]);
  });
});
