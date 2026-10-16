import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import { createDomainExpertBackend } from "../src/adapters/reviewers.js";
import { resolveAnswerReviewGateConfig } from "../src/config.js";
import type { DomainExpertsFace, ReviewInput } from "../src/types.js";

const images: readonly Extract<ContentBlock, { type: "image" }>[] = [
  {
    type: "image",
    attachment: {
      attachmentId: "sha256:cafebabe1234" as never,
      mediaType: "image/png",
      bytes: 2048,
      width: 64,
      height: 64,
    },
  },
];
const input: ReviewInput = {
  sessionId: "session-image-review",
  turn: 1,
  requestText: "Explain the screenshot.",
  requestAttachments: ["Image screenshot.png"],
  requestImages: images,
  candidateText: "The screenshot shows a duplicate value error.",
  signal: new AbortController().signal,
};
const config = resolveAnswerReviewGateConfig({
  reviewer: { domain: "answer-reviewer" },
}).reviewer;
const result = {
  status: "completed",
  structured: true,
  summary: "Checked the screenshot.",
  findings: [],
  conflicts: [],
};

describe("domain reviewer image input", () => {
  it("does not silently fall back to a text-only review with an older service", async () => {
    const testExpert = vi.fn();
    const backend = createDomainExpertBackend({ face: { testExpert }, config });
    await expect(backend.review(input)).rejects.toMatchObject({
      reason: "expert-image-input-unavailable",
    });
    expect(testExpert).not.toHaveBeenCalled();
  });

  it("preserves image refs across saved text packets and structured capture recovery", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-image-"));
    const testExpert = vi.fn();
    const tasks: string[] = [];
    const face: DomainExpertsFace = {
      testExpert,
      reviewExpert: vi.fn(async (domain, task, parent, suppliedImages) => {
        expect(domain).toBe(config.domain);
        expect(parent).toBe(input.sessionId);
        expect(suppliedImages).toEqual(images);
        tasks.push(task);
        return {
          ok: true,
          code: "",
          message: "",
          result:
            tasks.length === 1
              ? { ...result, structured: false, diagnostic: "" }
              : result,
        };
      }),
    };
    try {
      const candidateText = `${"Complete answer. ".repeat(1500)}Last screenshot finding.`;
      const backend = createDomainExpertBackend({
        face,
        config,
        workspaceRoot: root,
      });
      await expect(
        backend.review({ ...input, candidateText }),
      ).resolves.toMatchObject({ verdict: "pass" });
      expect(testExpert).not.toHaveBeenCalled();
      expect(tasks).toHaveLength(2);
      const packetPath = /review-packet: (.+)/u.exec(tasks[0]!)![1]!;
      const packet = await readFile(path.join(root, packetPath), "utf8");
      expect(packet).toContain(candidateText);
      expect(packet).not.toContain(
        "image omitted because this model accepts text only",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
