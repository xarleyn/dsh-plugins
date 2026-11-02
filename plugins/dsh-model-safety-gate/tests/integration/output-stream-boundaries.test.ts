import { describe, expect, it } from "vitest";

import { guardOutputStream } from "../../src/guards/output-stream.js";
import { makeTestGate } from "../helpers/make-gate.js";
import {
  baseConfig,
  chunkStream,
  collect,
  makeLookup,
  textChunks,
} from "./output-stream.helpers.js";

describe("buffered output partition invariance", () => {
  // A scanner marker only: the fixture contains no private key material.
  const marker = "-----BEGIN PRIVATE KEY-----";

  it.each([1, 7, 48, 128, 512])(
    "blocks every marker split around full windows with delta size %i",
    async (chunkSize) => {
      for (const boundary of [128, 208]) {
        for (let split = 1; split < marker.length; split += 1) {
          const source =
            "x".repeat(boundary - split) + marker + "y".repeat(250);
          const gate = makeTestGate({
            config: { ...baseConfig, classifier: { backend: "none" } },
          });
          const cancellations: string[] = [];
          const { lookup } = makeLookup(cancellations);
          const released = await collect(
            guardOutputStream(chunkStream(textChunks(source, chunkSize)), {
              config: gate.config,
              pipeline: gate.pipeline,
              agentLookup: lookup,
              sessionId: "session-1",
              turn: 1,
              step: null,
            }),
          );
          const text = released
            .map((chunk) => (chunk.type === "text-delta" ? chunk.text : ""))
            .join("");
          expect(text).not.toContain(marker);
          expect(source.startsWith(text)).toBe(true);
          expect(
            cancellations,
            `boundary=${boundary}, split=${split}`,
          ).toHaveLength(1);
          expect(released.at(-1)).toMatchObject({
            type: "finish",
            reason: { failure: { code: "SAFETY_OUTPUT_BLOCKED" } },
          });
        }
      }
    },
  );

  it.each([1, 7, 48, 128, 512])(
    "releases clean text exactly once and in order with delta size %i",
    async (chunkSize) => {
      const source = "Ordinary answer text. ".repeat(23);
      const gate = makeTestGate({ config: baseConfig });
      const cancellations: string[] = [];
      const { lookup } = makeLookup(cancellations);
      const released = await collect(
        guardOutputStream(chunkStream(textChunks(source, chunkSize)), {
          config: gate.config,
          pipeline: gate.pipeline,
          agentLookup: lookup,
          sessionId: "session-1",
          turn: 1,
          step: null,
        }),
      );
      expect(released[0]?.type).toBe("block-start");
      expect(released.at(-1)?.type).toBe("block-end");
      expect(
        released.filter((chunk) => chunk.type === "block-start"),
      ).toHaveLength(1);
      expect(
        released
          .map((chunk) => (chunk.type === "text-delta" ? chunk.text : ""))
          .join(""),
      ).toBe(source);
      expect(cancellations).toHaveLength(0);
    },
  );
});
