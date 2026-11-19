// Run in the isolated reader's Linux namespace with Node's test runner.
import assert from "node:assert/strict";
import { createPrivateKey } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readArchive } from "../lib/search-sources/reader.js";
import { setTimeout } from "node:timers/promises";
import { ArchiveGateway } from "../lib/search-sources/gateway.js";

test(
  "isolated QA namespace sees ordinary docs and redeems selected reads only through its reader",
  {
    skip: process.env.QA_ARCHIVE_COMPOSE_TEST !== "1",
  },
  async () => {
    assert.deepEqual(await readdir("/workspace/additional"), []);
    assert.equal(
      (await readFile("/workspace/docs/ordinary.txt", "utf8")).trim(),
      "ordinary",
    );
    const issuer = createPrivateKey(
      await readFile(process.env.QA_SOURCE_SIGNING_KEY),
    );
    const gateway = new ArchiveGateway(18791, 18792, issuer);
    const signal = globalThis.AbortSignal.timeout(20000);
    // Compose can schedule the two processes in either order. This path is
    // refused by the worker before it opens the archive or contacts the Host.
    while (!signal.aborted) {
      const ready = await globalThis
        .fetch("http://127.0.0.1:18791/ready", { signal })
        .catch(() => undefined);
      if (ready?.status === 403) break;
      await setTimeout(100);
    }
    signal.throwIfAborted();
    let allowed = false;
    const check = async () => assert.ok(allowed, "revoked");
    const op = {
      action: "read",
      directory: "manuals",
      path: "sample.txt",
      query: "",
      offset: 0,
    };
    try {
      await assert.rejects(gateway.perform(op, check, signal), /revoked/);
      allowed = true;
      const result = await gateway.perform(op, check, signal);
      assert.equal(result.text.trim(), "selected document");
      allowed = false;
      await assert.rejects(gateway.perform(op, check, signal), /revoked/);
    } finally {
      gateway.dispose();
    }
  },
);

test(
  "directory-scoped list, filename search, UTF-8 pages and verified addresses",
  { skip: process.platform !== "linux" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "qa-archive-test-"));
    const signal = new globalThis.AbortController().signal;
    const run = (action, path = "", offset = 0, query = "") =>
      readArchive(
        root,
        { directory: "docs", action, path, offset, query },
        signal,
      );
    try {
      await mkdir(join(root, "docs", "one"), { recursive: true });
      await mkdir(join(root, "other"));
      await writeFile(join(root, "other", "note.txt"), "independent source");
      const text = "a".repeat(65535) + "я";
      await writeFile(join(root, "docs", "one", "report.txt"), text);
      await symlink(join(root, "other"), join(root, "docs", "alias"));
      assert.deepEqual(await run("list"), {
        entries: [{ name: "one", kind: "directory" }],
        nextOffset: null,
      });
      assert.deepEqual(await run("search", "one", 0, "REPORT"), {
        entries: [{ name: "report.txt", kind: "file" }],
        nextOffset: null,
      });
      const page = await run("read", "one/report.txt");
      assert.equal(page.nextOffset, 65535);
      const last = await run("read", "one/report.txt", page.nextOffset);
      assert.equal(page.text + last.text, text);
      assert.equal(last.nextOffset, null);
      assert.deepEqual(await run("link", "one/report.txt"), {
        path: "one/report.txt",
      });
      await assert.rejects(run("link", "one/missing.txt"));
      await assert.rejects(run("list", "alias"));
      await assert.rejects(run("list", "../other"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
