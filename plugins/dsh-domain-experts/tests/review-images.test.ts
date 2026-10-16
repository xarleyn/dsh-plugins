import { Context } from "@deepseek-ai/cordis";
import { describe, expect, it } from "vitest";
import { DomainExpertsService } from "../src/index.js";
import type { ExpertRunInput } from "../src/host/execution.js";
import type { DomainExpertsStorage } from "../src/host/storage.js";
import {
  agentOf,
  domainOf,
  domainTableOf,
  fakeSubagents,
  memoryRecordTableOf,
} from "./helpers/fakes.js";

describe("host-only reviewer images", () => {
  it.each([true, false])(
    "requires the exact parent and delivers original image blocks (live: %s)",
    async (live) => {
      const ctx = new Context();
      const parent = agentOf({ id: "session-images", cwd: "/repo" });
      const definition = domainOf("answer-reviewer");
      const tables = {
        domains: domainTableOf([[definition.id, definition]]),
        memory: memoryRecordTableOf(),
      };
      const subagents = fakeSubagents({
        structured: {
          summary: "Verified image evidence.",
          findings: [],
          conflicts: [],
          assumptions: [],
          followUps: [],
        },
      });
      ctx.provide("tools", { register: () => () => {} });
      ctx.provide("agents", {
        get: (id: string) => (id === "session-images" ? parent : undefined),
        list: () => [parent],
      });
      ctx.provide("subagents", subagents);
      ctx.provide("storageDomain", {
        open: () =>
          Promise.resolve({
            name: "domain_experts",
            table: (name: keyof typeof tables) => tables[name],
            close: () => Promise.resolve(),
          } as unknown as DomainExpertsStorage),
      });
      const service = new DomainExpertsService(ctx, {});
      const images: NonNullable<ExpertRunInput["images"]> = [
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
      try {
        const outcome = await service.reviewExpert(
          definition.id,
          "Review the screenshot.",
          live ? "session-images" : "missing-session",
          images,
        );
        if (!live) {
          expect(outcome.ok).toBe(false);
          expect(outcome.code).toBe("TASK_REJECTED");
          expect(subagents.started).toHaveLength(0);
          return;
        }
        expect(outcome.ok).toBe(true);
        const request = subagents.started[0]!.request;
        expect(
          request.prompt.filter((block) => block.type === "image"),
        ).toEqual(images);
        expect(request.prompt[0]).toMatchObject({
          type: "text",
          text: expect.stringContaining("Review the screenshot."),
        });
        expect(request.outputSchema).toBeDefined();
        expect(request.parent).toBe(parent);
        expect(subagents.disposed).toHaveLength(1);
      } finally {
        await service["stores"].close();
      }
    },
  );
});
