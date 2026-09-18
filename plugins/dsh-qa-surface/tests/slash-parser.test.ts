import { describe, expect, it } from "vitest";
import {
  parseSlashLine,
  skillGestures,
  slashInvocation,
  slashPaletteQuery,
} from "../src/slash/parser.js";

describe("slash parser", () => {
  it("parses a bare command line", () => {
    expect(parseSlashLine("/foo")).toEqual({ name: "foo", args: "" });
  });

  it("keeps the separator whitespace in the raw input", () => {
    expect(parseSlashLine("/foo arg")).toEqual({ name: "foo", args: " arg" });
    expect(parseSlashLine("/foo  two  words")).toEqual({
      name: "foo",
      args: "  two  words",
    });
  });

  it("accepts both native name grammars", () => {
    expect(parseSlashLine("/foo-bar")?.name).toBe("foo-bar");
    expect(parseSlashLine("/foo_bar")?.name).toBe("foo_bar");
    expect(parseSlashLine("/plan2")?.name).toBe("plan2");
  });

  it("does not call a path or a fraction a command", () => {
    // The name must be followed by end-of-input or whitespace, so these stay
    // ordinary text exactly as the native command runtime reads them.
    expect(parseSlashLine("/usr/bin/env")).toBeUndefined();
    expect(parseSlashLine("/5/8")).toBeUndefined();
    expect(parseSlashLine("/Foo")).toBeUndefined();
    expect(parseSlashLine("просто текст")).toBeUndefined();
    expect(parseSlashLine("ordinary /foo text")).toBeUndefined();
    expect(parseSlashLine(" /foo")).toBeUndefined();
  });

  it("trims the separator whitespace off an invocation's arguments", () => {
    expect(slashInvocation("/generate-tkp Сделай ТКП")).toEqual({
      name: "generate-tkp",
      args: "Сделай ТКП",
    });
    expect(slashInvocation("/compact")).toEqual({ name: "compact", args: "" });
    expect(slashInvocation("/usr/bin")).toBeUndefined();
  });

  describe("palette query", () => {
    it("opens on a bare slash and on a partially typed name", () => {
      expect(slashPaletteQuery("/")).toBe("");
      expect(slashPaletteQuery("/gene")).toBe("gene");
      expect(slashPaletteQuery("/generate-tkp")).toBe("generate-tkp");
      expect(slashPaletteQuery("/gen_x-2")).toBe("gen_x-2");
    });

    it("closes as soon as the draft is no longer a name", () => {
      // The space is the signal: the user is writing arguments now.
      expect(slashPaletteQuery("/gen ")).toBeUndefined();
      expect(slashPaletteQuery("/generate-tkp Заказчику")).toBeUndefined();
      expect(slashPaletteQuery("текст /gene")).toBeUndefined();
      expect(slashPaletteQuery("/Привет")).toBeUndefined();
      expect(slashPaletteQuery("")).toBeUndefined();
    });
  });

  describe("skill gestures", () => {
    it("finds a whitespace-bounded /name anywhere in the text", () => {
      expect(
        skillGestures(
          "Пожалуйста, используй /generate-tkp для этих требований",
        ),
      ).toEqual(["generate-tkp"]);
    });

    it("deduplicates and preserves first-seen order", () => {
      expect(skillGestures("/b /a /b")).toEqual(["b", "a"]);
    });

    it("ignores paths, fractions and a leading slash inside a word", () => {
      expect(skillGestures("смотри /usr/bin или 5/8")).toEqual([]);
      expect(skillGestures("путь/foo")).toEqual([]);
      expect(skillGestures("/Foo")).toEqual([]);
    });

    it("accepts the token at either end of the text", () => {
      expect(skillGestures("/generate-tkp начало")).toEqual(["generate-tkp"]);
      expect(skillGestures("конец /generate-tkp")).toEqual(["generate-tkp"]);
    });
  });
});
