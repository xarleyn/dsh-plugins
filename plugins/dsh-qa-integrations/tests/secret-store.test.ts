import { randomBytes } from "node:crypto";
import { MemoryKeyProvider } from "../src/secrets/key-provider.js";
import { SecretStore } from "../src/secrets/secret-store.js";

describe("SecretStore", () => {
  it("uses unique AEAD envelopes and decrypts them", async () => {
    const keys = new MemoryKeyProvider(new Map([[1, randomBytes(32)]]), 1);
    const store = new SecretStore(keys);
    const left = await store.encrypt("top-secret", "token");
    const right = await store.encrypt("top-secret", "token");
    expect(left.ciphertext).not.toBe(right.ciphertext);
    expect(left.nonce).not.toBe(right.nonce);
    expect(left.wrappedDek).not.toBe(right.wrappedDek);
    expect(JSON.stringify(left)).not.toContain("top-secret");
    await expect(store.decrypt(left)).resolves.toBe("top-secret");
  });

  it("fails authentication with the wrong key", async () => {
    const original = new SecretStore(
      new MemoryKeyProvider(new Map([[1, randomBytes(32)]]), 1),
    );
    const record = await original.encrypt("secret", "token");
    const wrong = new SecretStore(
      new MemoryKeyProvider(new Map([[1, randomBytes(32)]]), 1),
    );
    await expect(wrong.decrypt(record)).rejects.toThrow();
  });

  it("rewraps the DEK onto a new master-key version", async () => {
    const first = randomBytes(32);
    const second = randomBytes(32);
    const v1 = new SecretStore(
      new MemoryKeyProvider(
        new Map([
          [1, first],
          [2, second],
        ]),
        1,
      ),
    );
    const record = await v1.encrypt("rotatable", "token");
    const v2 = new SecretStore(
      new MemoryKeyProvider(
        new Map([
          [1, first],
          [2, second],
        ]),
        2,
      ),
    );
    const rotated = await v2.rewrap(record);
    expect(rotated.keyVersion).toBe(2);
    expect(rotated.ciphertext).toBe(record.ciphertext);
    await expect(v2.decrypt(rotated)).resolves.toBe("rotatable");
  });
});
