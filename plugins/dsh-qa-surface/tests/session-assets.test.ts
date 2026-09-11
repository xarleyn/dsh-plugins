import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionAssetRepository } from "../src/client/session-assets.js";

describe("SessionAssetRepository", () => {
  const revoked: string[] = [];
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    revoked.length = 0;
  });

  /** The stub keys blob URLs by the caller's marker, not by a real Blob. */
  const createBlobUrl = (marker: string) =>
    (URL.createObjectURL as unknown as (part: string) => string)(marker);

  function stubBlobUrls(): void {
    URL.createObjectURL = vi.fn(
      (marker: string) => `blob:session-assets/${marker}`,
    ) as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn((url: string) => {
      revoked.push(url);
    }) as unknown as typeof URL.revokeObjectURL;
  }

  it("deduplicates concurrent reads of one attachment", async () => {
    const repo = new SessionAssetRepository();
    const load = vi.fn(async (id: string) => `url:${id}`);
    const first = repo.resolve("chat-1", "att-1", load);
    const second = repo.resolve("chat-1", "att-1", load);
    expect(await first).toBe("url:att-1");
    expect(await second).toBe("url:att-1");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("caches per chat: equal attachment ids stay independent", async () => {
    const repo = new SessionAssetRepository();
    const load = vi.fn(async (id: string) => `url:${id}`);
    expect(await repo.resolve("chat-1", "att-1", load)).toBe("url:att-1");
    expect(await repo.resolve("chat-2", "att-1", load)).toBe("url:att-1");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("drops a failed resolution so a retry reads again", async () => {
    const repo = new SessionAssetRepository();
    let fail = true;
    const load = vi.fn(async () => {
      if (fail) throw new Error("gone");
      return "url:ok";
    });
    await expect(repo.resolve("chat-1", "att-1", load)).rejects.toThrow("gone");
    fail = false;
    expect(await repo.resolve("chat-1", "att-1", load)).toBe("url:ok");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("revokes blob URLs on release but leaves data URLs alone", async () => {
    stubBlobUrls();
    const repo = new SessionAssetRepository();
    await repo.resolve("chat-1", "att-blob", async () =>
      createBlobUrl("image/png"),
    );
    await repo.resolve(
      "chat-1",
      "att-data",
      async () => "data:image/png;base64,x",
    );
    repo.release("chat-1");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(revoked).toEqual(["blob:session-assets/image/png"]);
    // A released chat re-resolves from scratch.
    const load = vi.fn(async () => "url:again");
    expect(await repo.resolve("chat-1", "att-blob", load)).toBe("url:again");
  });

  it("dispose releases every chat", async () => {
    stubBlobUrls();
    const repo = new SessionAssetRepository();
    await repo.resolve("chat-1", "att-1", async () =>
      createBlobUrl("image/png"),
    );
    await repo.resolve("chat-2", "att-2", async () =>
      createBlobUrl("image/jpeg"),
    );
    repo.dispose();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(revoked).toEqual([
      "blob:session-assets/image/png",
      "blob:session-assets/image/jpeg",
    ]);
  });
});
