import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import type { EncryptedSecretRecord, IntegrationAuthKind } from "../types.js";
import type { KeyProvider, WrappedKey } from "./key-provider.js";

function encode(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function decode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function wrappedOf(record: EncryptedSecretRecord): WrappedKey {
  return {
    ciphertext: decode(record.wrappedDek),
    nonce: decode(record.wrapNonce),
    authTag: decode(record.wrapAuthTag),
    keyVersion: record.keyVersion,
  };
}

/** Envelope-encrypted, AEAD-authenticated secret codec. */
export class SecretStore {
  constructor(private readonly keys: KeyProvider) {}

  async encrypt(
    plaintext: string,
    secretType: IntegrationAuthKind,
    expiresAt: string | null = null,
  ): Promise<EncryptedSecretRecord> {
    const id = randomUUID();
    const dek = randomBytes(32);
    const body = Buffer.from(plaintext, "utf8");
    const nonce = randomBytes(12);
    try {
      const cipher = createCipheriv("aes-256-gcm", dek, nonce);
      cipher.setAAD(Buffer.from(`${id}:${secretType}`, "utf8"));
      const ciphertext = Buffer.concat([cipher.update(body), cipher.final()]);
      const wrapped = await this.keys.wrapKey(dek);
      const now = new Date().toISOString();
      return Object.freeze({
        id,
        ciphertext: encode(ciphertext),
        nonce: encode(nonce),
        authTag: encode(cipher.getAuthTag()),
        wrappedDek: encode(wrapped.ciphertext),
        wrapNonce: encode(wrapped.nonce),
        wrapAuthTag: encode(wrapped.authTag),
        keyVersion: wrapped.keyVersion,
        secretType,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      });
    } finally {
      dek.fill(0);
      body.fill(0);
    }
  }

  async decrypt(record: EncryptedSecretRecord): Promise<string> {
    const dek = Buffer.from(await this.keys.unwrapKey(wrappedOf(record)));
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        dek,
        decode(record.nonce),
      );
      decipher.setAAD(Buffer.from(`${record.id}:${record.secretType}`, "utf8"));
      decipher.setAuthTag(decode(record.authTag));
      const plaintext = Buffer.concat([
        decipher.update(decode(record.ciphertext)),
        decipher.final(),
      ]);
      try {
        return plaintext.toString("utf8");
      } finally {
        plaintext.fill(0);
      }
    } finally {
      dek.fill(0);
    }
  }

  /** Rewrap only the DEK; provider ciphertext never needs plaintext re-encryption. */
  async rewrap(record: EncryptedSecretRecord): Promise<EncryptedSecretRecord> {
    const dek = Buffer.from(await this.keys.unwrapKey(wrappedOf(record)));
    try {
      const wrapped = await this.keys.wrapKey(dek);
      return Object.freeze({
        ...record,
        wrappedDek: encode(wrapped.ciphertext),
        wrapNonce: encode(wrapped.nonce),
        wrapAuthTag: encode(wrapped.authTag),
        keyVersion: wrapped.keyVersion,
        updatedAt: new Date().toISOString(),
      });
    } finally {
      dek.fill(0);
    }
  }
}
