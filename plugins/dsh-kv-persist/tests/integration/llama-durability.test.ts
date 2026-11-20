import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import { LlamaCppClient } from "../../src/backends/llama-cpp/client.js";
import { buildSnapshotIdentity } from "../../src/snapshots/fingerprint.js";
import { nextSnapshotFilename } from "../../src/snapshots/naming.js";
import { SnapshotRepository } from "../../src/snapshots/repository.js";

const binary = process.env.DSH_KV_TEST_LLAMA_BIN;
const model = process.env.DSH_KV_TEST_LLAMA_MODEL;

async function loopbackPort() {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const address = socket.address();
  socket.close();
  await once(socket, "close");
  if (!address || typeof address === "string") throw Error("no loopback port");
  return address.port;
}

// This test owns both the process it interrupts and every file it changes.
it.skipIf(!binary || !model)(
  "recovers the published generation after killing llama-server during overwrite",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "kv-interruption-"));
    const slots = join(root, "slots");
    await mkdir(slots);
    const repository = new SnapshotRepository(join(root, "meta"));
    const port = await loopbackPort();
    const baseURL = `http://127.0.0.1:${port}`;
    const start = () => {
      const child = spawn(
        binary!,
        [
          "-m",
          model!,
          "--host",
          "127.0.0.1",
          "--port",
          String(port),
          "--device",
          "none",
          "-ngl",
          "0",
          "-t",
          "2",
          "-tb",
          "2",
          "-c",
          "4096",
          "-np",
          "1",
          "--no-warmup",
          "--slots",
          "--slot-save-path",
          slots,
        ],
        { stdio: "ignore", windowsHide: true },
      );
      const exited = once(child, "exit");
      return {
        child,
        stop: async () => {
          child.kill("SIGKILL");
          await exited;
        },
      };
    };
    let server = start();
    const ready = async () => {
      for (let n = 0; n < 300 && server.child.exitCode === null; n++) {
        if (
          await fetch(baseURL + "/health", {
            signal: AbortSignal.timeout(1000),
          }).then(
            (r) => r.ok,
            () => false,
          )
        )
          return;
        await delay(100);
      }
      throw Error("owned CPU server did not become ready");
    };
    const prefill = async (tokens: number) => {
      const result = await fetch(baseURL + "/completion", {
        method: "POST",
        body: JSON.stringify({
          id_slot: 0,
          prompt: Array<number>(tokens).fill(42),
          cache_prompt: true,
          n_predict: 1,
        }),
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(60000),
      });
      expect(result.status).toBe(200);
      await result.text();
    };
    const client = new LlamaCppClient({
      baseURL,
      apiKey: null,
      requestTimeoutMs: 15000,
    });
    const identity = buildSnapshotIdentity({
      baseURL,
      runtimeKey: null,
      route: { provider: "test", model: "test" },
      sessionId: "session",
    });
    try {
      await ready();
      await prefill(64);
      const first = nextSnapshotFilename(identity);
      const saved = await client.saveSlot(0, first);
      const previous = await repository.put({
        identity,
        snapshotFilename: first,
        slotId: 0,
        sessionSeq: null,
        tokens: null,
        bytes: saved.bytes,
        now: new Date().toISOString(),
      });
      const original = await readFile(join(slots, first));
      expect(saved.bytes).toBe(original.length);
      const second = nextSnapshotFilename(identity, previous.snapshotFilename);
      const target = join(slots, second);
      // Give the inactive name an identical, previously recoverable checkpoint.
      await copyFile(join(slots, first), target);
      const baseline = await client.restoreSlot(0, second);
      expect(baseline.nRestored).toBeGreaterThan(0);
      await prefill(3072);
      const control = await client.saveSlot(0, "control.bin");
      expect(control.bytes).toBeGreaterThan(original.length);
      const write = client.saveSlot(0, second).then(
        () => true,
        () => false,
      );
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const size = (await stat(target)).size;
        if (size !== original.length && size < control.bytes!) break;
        if (size >= control.bytes!) throw Error("missed interruption window");
      }
      await server.stop();
      await write;
      const partial = (await stat(target)).size;
      expect(partial).toBeLessThan(control.bytes!);
      expect((await readFile(target)).equals(original)).toBe(false);
      server = start();
      await ready();
      const manifest = await repository.findCompatible(identity);
      expect(manifest).toEqual(previous);
      expect((await readFile(join(slots, first))).equals(original)).toBe(true);
      await expect(
        client.restoreSlot(0, manifest!.snapshotFilename),
      ).resolves.toEqual(baseline);
      await expect(client.restoreSlot(0, second)).rejects.toThrow();
      process.stdout.write(
        `checkpoint interruption ${JSON.stringify({ previousBytes: original.length, interruptedBytes: partial, completeBytes: control.bytes, restoredTokens: baseline.nRestored })}\n`,
      );
    } finally {
      await server.stop();
      await rm(root, { recursive: true, force: true });
    }
  },
  120000,
);
