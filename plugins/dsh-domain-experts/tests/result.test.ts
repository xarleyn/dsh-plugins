import { describe, expect, it } from "vitest";
import { parseExpertAnswer, textOfBlocks } from "../src/host/result.js";

const STRUCTURED = [
  "I looked at the batch scheduler.",
  "",
  "```domain-expert-result",
  JSON.stringify({
    summary: "The status is stale because the batch aborts before committing.",
    findings: [
      {
        claim: "The scheduler aborts on timeout",
        evidence: ["services/payments/batch.ts:41"],
        confidence: "high",
      },
      { claim: "The retry path never runs" },
    ],
    conflicts: ["The README says the batch is idempotent"],
    assumptions: ["The batch runs hourly"],
    followUps: ["Check the retry configuration"],
  }),
  "```",
].join("\n");

describe("result: structured parsing", () => {
  it("reads the tagged block and keeps the prose as fallback context", () => {
    const parsed = parseExpertAnswer(STRUCTURED);
    expect(parsed.structured).toBe(true);
    expect(parsed.summary).toContain("stale because the batch aborts");
    expect(parsed.findings).toHaveLength(2);
    expect(parsed.findings[0]?.confidence).toBe("high");
    expect(parsed.findings[1]?.confidence).toBe("medium");
    expect(parsed.findings[1]?.evidence).toEqual([]);
    expect(parsed.conflicts).toEqual([
      "The README says the batch is idempotent",
    ]);
    expect(parsed.followUps).toEqual(["Check the retry configuration"]);
  });

  it("accepts a plain json fence", () => {
    const parsed = parseExpertAnswer(
      '```json\n{"summary":"ok","findings":[]}\n```',
    );
    expect(parsed.structured).toBe(true);
    expect(parsed.summary).toBe("ok");
  });

  it("accepts an unfenced object with the expected shape", () => {
    const parsed = parseExpertAnswer(
      'Here it is: {"summary":"bare","findings":["plain claim"]}',
    );
    expect(parsed.structured).toBe(true);
    expect(parsed.summary).toBe("bare");
    expect(parsed.findings[0]?.claim).toBe("plain claim");
  });

  it("degrades to prose instead of losing the answer", () => {
    const parsed = parseExpertAnswer(
      "The batch is fine, I found nothing wrong.",
    );
    expect(parsed.structured).toBe(false);
    expect(parsed.summary).toBe("The batch is fine, I found nothing wrong.");
    expect(parsed.findings).toEqual([]);
  });

  it("prefers the tagged fence over a json fence", () => {
    const text = [
      "```json",
      '{"summary":"wrong"}',
      "```",
      "```domain-expert-result",
      '{"summary":"right"}',
      "```",
    ].join("\n");
    expect(parseExpertAnswer(text).summary).toBe("right");
  });

  it("survives malformed JSON in the fence", () => {
    const parsed = parseExpertAnswer(
      "```domain-expert-result\n{ not json }\n```",
    );
    expect(parsed.structured).toBe(false);
  });

  it("survives braces inside strings", () => {
    const parsed = parseExpertAnswer(
      '```domain-expert-result\n{"summary":"uses { and } inside the text"}\n```',
    );
    expect(parsed.structured).toBe(true);
    expect(parsed.summary).toBe("uses { and } inside the text");
  });

  it("normalizes an unknown confidence to medium", () => {
    const parsed = parseExpertAnswer(
      '```domain-expert-result\n{"findings":[{"claim":"x","confidence":"certain"}]}\n```',
    );
    expect(parsed.findings[0]?.confidence).toBe("medium");
  });
});

describe("result: content blocks", () => {
  it("joins text blocks and ignores everything else", () => {
    expect(
      textOfBlocks([
        { type: "reasoning", text: "hidden" },
        { type: "text", text: "first" },
        { type: "image", data: "x" },
        { type: "text", text: "second" },
      ]),
    ).toBe("first\n\nsecond");
  });

  it("returns an empty string for no text blocks", () => {
    expect(textOfBlocks([{ type: "image" }, null, "text"])).toBe("");
  });
});
