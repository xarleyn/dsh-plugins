import { describe, it, expect } from "vitest";
import { createDraft, initialize, checkCompatibility } from "../src/index";

describe("draft-sessions", () => {
  describe("createDraft", () => {
    it("should create a draft with required fields", () => {
      const draft = createDraft("Test Draft", "Content here");

      expect(draft).toBeDefined();
      expect(draft.id).toMatch(/^draft-/);
      expect(draft.title).toBe("Test Draft");
      expect(draft.content).toBe("Content here");
      expect(typeof draft.createdAt).toBe("number");
      expect(typeof draft.updatedAt).toBe("number");
    });

    it("should update updatedAt when creating", () => {
      const draft = createDraft("Test", "Content");
      expect(draft.updatedAt).toBeGreaterThanOrEqual(draft.createdAt);
    });
  });

  describe("initialize", () => {
    it("should initialize without errors", async () => {
      await expect(initialize()).resolves.not.toThrow();
    });

    it("should accept custom config", async () => {
      await expect(
        initialize({ maxDrafts: 10, autoSaveInterval: 60_000 }),
      ).resolves.not.toThrow();
    });
  });

  describe("checkCompatibility", () => {
    it("should return a boolean", () => {
      const result = checkCompatibility();
      expect(typeof result).toBe("boolean");
    });
  });
});
