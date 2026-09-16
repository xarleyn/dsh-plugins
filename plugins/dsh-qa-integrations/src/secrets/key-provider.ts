import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

export interface WrappedKey {
  readonly ciphertext: Uint8Array;
  readonly nonce: Uint8Array;
  readonly authTag: Uint8Array;
  readonly keyVersion: number;
}

export interface KeyProvider {
  readonly currentVersion: number;
  wrapKey(rawDek: Uint8Array): Promise<WrappedKey>;
  unwrapKey(wrapped: WrappedKey): Promise<Uint8Array>;
}

function decodeMasterKey(raw: Buffer): Buffer {
  if (raw.length === 32) return Buffer.from(raw);
  const text = raw.toString("utf8").trim();
  if (/^[a-f\d]{64}$/iu.test(text)) return Buffer.from(text, "hex");
  const decoded = Buffer.from(
    text.replace(/-/gu, "+").replace(/_/gu, "/"),
    "base64",
  );
  if (decoded.length === 32) return decoded;
  throw new Error("QA integrations master key must contain exactly 32 bytes");
}

function seal(
  key: Uint8Array,
  plaintext: Uint8Array,
): Omit<WrappedKey, "keyVersion"> {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, nonce, authTag: cipher.getAuthTag() };
}

function open(key: Uint8Array, wrapped: WrappedKey): Uint8Array {
  const decipher = createDecipheriv("aes-256-gcm", key, wrapped.nonce);
  decipher.setAuthTag(wrapped.authTag);
  return Buffer.concat([decipher.update(wrapped.ciphertext), decipher.final()]);
}

/** MVP key provider: a 256-bit key read from a Docker secret file. */
export class DockerSecretKeyProvider implements KeyProvider {
  private key: Buffer | undefined;

  constructor(
    private readonly filePath: string,
    readonly currentVersion: number,
  ) {}

  async wrapKey(rawDek: Uint8Array): Promise<WrappedKey> {
    return { ...seal(this.load(), rawDek), keyVersion: this.currentVersion };
  }

  async unwrapKey(wrapped: WrappedKey): Promise<Uint8Array> {
    if (wrapped.keyVersion !== this.currentVersion) {
      throw new Error(
        `Master key version ${wrapped.keyVersion} is unavailable`,
      );
    }
    return open(this.load(), wrapped);
  }

  private load(): Buffer {
    if (this.key === undefined)
      this.key = decodeMasterKey(readFileSync(this.filePath));
    return this.key;
  }
}

/** Multi-version test/rotation provider; production KMS adapters follow this seam. */
export class MemoryKeyProvider implements KeyProvider {
  private readonly keys: ReadonlyMap<number, Uint8Array>;

  constructor(
    keys: ReadonlyMap<number, Uint8Array>,
    readonly currentVersion: number,
  ) {
    this.keys = new Map(
      [...keys].map(([version, key]) => {
        if (key.byteLength !== 32)
          throw new Error("Master key must be 32 bytes");
        return [version, Uint8Array.from(key)] as const;
      }),
    );
    if (!this.keys.has(currentVersion))
      throw new Error("Current master key is missing");
  }

  async wrapKey(rawDek: Uint8Array): Promise<WrappedKey> {
    const key = this.keys.get(this.currentVersion);
    if (key === undefined) throw new Error("Current master key is missing");
    return { ...seal(key, rawDek), keyVersion: this.currentVersion };
  }

  async unwrapKey(wrapped: WrappedKey): Promise<Uint8Array> {
    const key = this.keys.get(wrapped.keyVersion);
    if (key === undefined)
      throw new Error("Wrapped key version is unavailable");
    return open(key, wrapped);
  }
}
