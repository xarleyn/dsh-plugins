import { describe, expect, it } from "vitest";
import { QaChatIndex } from "../src/client/chat-index.js";
import type { StorageLike } from "../src/client/types.js";

function memoryStorage(existing: Record<string, string> = {}): StorageLike & {
  store: Map<string, string>;
} {
  const store = new Map(Object.entries(existing));
  return {
    store,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  };
}

function index(storage?: StorageLike) {
  return new QaChatIndex(storage, "dsh-qa-surface.session:v1:/qa");
}

describe("QaChatIndex", () => {
  it("derives the session and chat keys from the prefix", () => {
    const storage = memoryStorage();
    index(storage).saveActive("s1");
    index(storage).rememberChat("s1");
    expect(storage.store.get("dsh-qa-surface.session:v1:/qa:session")).toBe(
      "s1",
    );
    expect(storage.store.get("dsh-qa-surface.session:v1:/qa:chats")).toBe(
      JSON.stringify(["s1"]),
    );
  });

  it("reads, dedupes and fronts the chat index", () => {
    const storage = memoryStorage({
      "dsh-qa-surface.session:v1:/qa:chats": JSON.stringify([
        "a",
        "b",
        "a",
        42,
      ]),
    });
    expect(index(storage).chatIds()).toEqual(["a", "b"]);
    index(storage).rememberChat("b");
    expect(index(storage).chatIds()).toEqual(["b", "a"]);
  });

  it("caps the index length", () => {
    const storage = memoryStorage();
    for (let i = 0; i < 60; i += 1) index(storage).rememberChat(`chat-${i}`);
    expect(index(storage).chatIds()).toHaveLength(50);
    expect(index(storage).chatIds()[0]).toBe("chat-59");
  });

  it("forgets chats and tolerates unknown ids", () => {
    const storage = memoryStorage({
      "dsh-qa-surface.session:v1:/qa:chats": JSON.stringify(["a", "b"]),
    });
    index(storage).forgetChat("a");
    index(storage).forgetChat("missing");
    expect(index(storage).chatIds()).toEqual(["b"]);
  });

  it("returns an empty index for broken storage payloads", () => {
    const storage = memoryStorage({
      "dsh-qa-surface.session:v1:/qa:chats": "{{{",
      "dsh-qa-surface.session:v1:/qa:session": "  ",
    });
    expect(index(storage).chatIds()).toEqual([]);
    expect(index(storage).activeId()).toBeNull();
  });

  it("round-trips and clears the active chat id", () => {
    const storage = memoryStorage();
    expect(index(storage).activeId()).toBeNull();
    index(storage).saveActive("s1");
    expect(index(storage).activeId()).toBe("s1");
    index(storage).clearActive();
    expect(index(storage).activeId()).toBeNull();
  });

  it("survives a throwing storage without affecting callers", () => {
    const storage: StorageLike = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    const chats = index(storage);
    expect(chats.chatIds()).toEqual([]);
    expect(chats.activeId()).toBeNull();
    expect(() => chats.rememberChat("s1")).not.toThrow();
    expect(() => chats.forgetChat("s1")).not.toThrow();
    expect(() => chats.saveActive("s1")).not.toThrow();
    expect(() => chats.clearActive()).not.toThrow();
  });

  it("works without any storage at all", () => {
    const chats = index();
    expect(chats.chatIds()).toEqual([]);
    expect(chats.activeId()).toBeNull();
    expect(() => chats.rememberChat("s1")).not.toThrow();
    expect(chats.activeId()).toBeNull();
  });
});
