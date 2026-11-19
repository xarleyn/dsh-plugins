import { generateKeyPairSync } from "node:crypto";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { expect, it, vi } from "vitest";
import { ArchiveGateway } from "../../src/search-sources/gateway.js";
import { archiveReader } from "../../src/search-sources/reader.js";
import type { ArchiveOperation } from "../../src/search-sources/protocol.js";

async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
}

it("authorizes each operation and discards results when access is withdrawn in flight", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const reserved = createServer();
  const authPort = await listen(reserved);
  let start!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let allowed = false;
  const verify = vi.fn(async () => {
    if (!allowed) throw new Error("revoked");
  });
  const read = vi.fn(async (op: ArchiveOperation) => {
    if (op.path === "slow.txt") {
      start();
      await released;
    }
    return { text: "permitted text" };
  });
  const reader = archiveReader(authPort, publicKey, read);
  const readerPort = await listen(reader);
  await new Promise<void>((r) => reserved.close(() => r()));
  const gateway = new ArchiveGateway(readerPort, authPort, privateKey);
  const op: ArchiveOperation = {
    action: "read",
    path: "file.txt",
    directory: "demo",
    query: "",
    offset: 0,
  };
  const signal = new AbortController().signal;
  try {
    await expect(gateway.perform(op, verify, signal)).rejects.toThrow(
      "revoked",
    );
    expect(read).not.toHaveBeenCalled();
    allowed = true;
    expect(await gateway.perform(op, verify, signal)).toEqual({
      text: "permitted text",
    });
    expect(read).toHaveBeenCalledTimes(1);
    const slow = gateway.perform({ ...op, path: "slow.txt" }, verify, signal);
    await started;
    allowed = false;
    release();
    await expect(slow).rejects.toThrow("revoked");
    for (const action of ["list", "search", "link", "read"] as const)
      await expect(
        gateway.perform({ ...op, action }, verify, signal),
      ).rejects.toThrow();
    expect(read).toHaveBeenCalledTimes(2);
  } finally {
    release();
    gateway.dispose();
    reader.closeAllConnections();
    reader.close();
  }
});
