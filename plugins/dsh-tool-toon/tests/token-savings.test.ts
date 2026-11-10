import { Buffer } from "node:buffer";
import { encode as encodeToon } from "@toon-format/toon";
import { encode as cl100k } from "gpt-tokenizer/encoding/cl100k_base";
import { encode as o200k } from "gpt-tokenizer/encoding/o200k_base";
import { expect, it } from "vitest";
import { formatJsonText, resolveToolToonConfig } from "../src/index.js";

// Explicit benchmark tokenizers, not a claim about a routed provider's tokenizer.
it.each(["uniform", "nested"])(
  "measures actual token counts for %s field catalogues",
  (shape) => {
    const value = {
      items: Array.from({ length: 100 }, (_, i) => ({
        id: `customfield_${10000 + i}`,
        name: `Демо-поле ${i}`,
        custom: true,
        type: "option",
        ...(shape === "nested"
          ? { clauseNames: [`cf[${10000 + i}]`, `Демо-поле ${i}`] }
          : {}),
        navigable: true,
        searchable: true,
        orderable: true,
      })),
    };
    const json = JSON.stringify(value);
    const selected = formatJsonText(json, resolveToolToonConfig());
    const toon = selected ?? "```toon\n" + encodeToon(value) + "\n```";
    const report = {
      shape,
      selected: selected !== null,
      jsonBytes: Buffer.byteLength(json),
      toonBytes: Buffer.byteLength(toon),
      cl100k: { json: cl100k(json).length, toon: cl100k(toon).length },
      o200k: { json: o200k(json).length, toon: o200k(toon).length },
    };
    if (shape === "uniform") {
      expect(selected).not.toBeNull();
      expect(report.cl100k.toon).toBeLessThan(report.cl100k.json);
      expect(report.o200k.toon).toBeLessThan(report.o200k.json);
    } else {
      // Array-valued cells lose the table form: converting this shape wastes
      // tokens. The adaptive bypass is part of the feature's contract.
      expect(selected).toBeNull();
      expect(report.cl100k.toon).toBeGreaterThan(report.cl100k.json);
      expect(report.o200k.toon).toBeGreaterThan(report.o200k.json);
    }
    process.stdout.write(`TOON token benchmark ${JSON.stringify(report)}\n`);
  },
);
