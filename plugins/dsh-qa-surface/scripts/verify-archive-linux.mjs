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
import { buildInventory } from "../lib/search-sources/inventory.js";
import { inventoryPolicy } from "../lib/search-sources/inventory-policy.js";
import { setTimeout } from "node:timers/promises";
import { ArchiveGateway } from "../lib/search-sources/gateway.js";

test("path inventory, live tree, pagination, exclusions and policy refresh", async () => {
  const root = await mkdtemp(join(tmpdir(), "qa-index-"));
  try {
    const source = join(root, "docs");
    const config = {
      policy: join(root, "rules.json"),
      inventory: join(root, "inventory.json"),
    };
    const rules = {
      directories: ["#recycle"],
      files: ["~$*", "desktop.ini"],
      sensitiveNames: ["*password*", "*учетн*запис*"],
      excludedExtensions: [".log"],
      allowedExtensions: [".txt", ".docx", ".pdf", ".log"],
    };
    await writeFile(config.policy, JSON.stringify(rules));
    const signal = new globalThis.AbortController().signal;
    for (const path of [
      "ID 12345 ID 54321/ID12345/Acts",
      "ID 12345 ID 54321/ID 54321/Acts",
      "snap/ACME",
      "closed/ACME",
      "2025/ID 12345/Contract 3001",
      "#Recycle",
      "УЧЁТНЫЕ ЗАПИСИ",
      "empty",
    ]) {
      await mkdir(join(source, path), { recursive: true });
    }
    const visible = "ID 12345 ID 54321/ID12345/Acts";
    for (const path of [
      visible + "/Report.PDF",
      "snap/ACME/project.docx",
      "#Recycle/hidden.txt",
      "УЧЁТНЫЕ ЗАПИСИ/test.txt",
      "passwords.txt",
      "~$temp.docx",
      "desktop.ini",
      "dump.log",
      "other.exe",
    ])
      await writeFile(join(source, path), "fixture");
    for (let i = 0; i < 105; i++)
      await writeFile(join(source, visible, i + ".txt"), "text");
    await symlink(join(source, "#Recycle"), join(source, "alias"));
    const index = await buildInventory(
      root,
      "docs",
      inventoryPolicy(config.policy),
      signal,
    );
    await writeFile(config.inventory, JSON.stringify(index));
    const run = (action, options = {}) =>
      readArchive(
        root,
        {
          directory: "docs",
          path: "",
          query: "",
          offset: 0,
          action,
          ...options,
        },
        signal,
        config,
      );
    const matches = await run("find", {
      query: "12345 Acts",
      kind: "directory",
    });
    assert.deepEqual(
      matches.entries.map((e) => e.path),
      [visible],
    );
    const contract = "2025/ID 12345/Contract 3001";
    assert.deepEqual(
      (
        await run("find", { query: "2025 ID №12345 Contract 3001" })
      ).entries.map((e) => e.path),
      [contract],
    );
    assert.deepEqual(
      (await run("find", { query: "ID 2025 Contract" })).entries,
      [],
    );
    assert.deepEqual(
      (await run("find", { query: "acme", kind: "directory" })).entries.map(
        (e) => e.path,
      ),
      ["closed/ACME", "snap/ACME"],
    );
    const page = await run("tree", { path: visible, depth: 1 });
    const paths = page.entries.map((e) => e.path);
    let offset = page.nextOffset;
    while (offset !== null) {
      const next = await run("tree", {
        path: visible,
        depth: 1,
        offset,
        snapshot: page.snapshot,
      });
      paths.push(...next.entries.map((e) => e.path));
      offset = next.nextOffset;
    }
    assert.deepEqual(
      paths.sort(),
      (await readdir(join(source, visible)))
        .map((n) => visible + "/" + n)
        .sort(),
    );
    const first = await run("list", { path: visible });
    assert.equal(first.entries.length, 100);
    assert.equal(
      (await run("list", { path: visible, offset: first.nextOffset })).entries
        .length,
      6,
    );
    assert.deepEqual((await run("list", { path: "empty" })).entries, []);
    assert.ok(
      (await run("tree", { depth: 1 })).entries.every(
        (e) => !e.path.includes("/"),
      ),
    );
    for (const name of [
      "#Recycle",
      "УЧЁТНЫЕ ЗАПИСИ",
      "alias",
      "passwords.txt",
      "~$temp.docx",
      "desktop.ini",
      "dump.log",
      "other.exe",
    ]) {
      assert.ok(!index.entries.some((e) => e.path.split("/").includes(name)));
      assert.ok(!(await run("list")).entries.some((e) => e.name === name));
      for (const action of ["link", "read"])
        await assert.rejects(
          run(action, {
            path: name.includes(".") ? name : name + "/hidden.txt",
          }),
        );
    }
    await rm(join(source, visible, "Report.PDF"));
    assert.deepEqual((await run("find", { query: "report" })).entries, []);
    await assert.rejects(run("tree", { snapshot: "different" }));
    await writeFile(
      config.policy,
      JSON.stringify({ ...rules, directories: [...rules.directories, "snap"] }),
    );
    await assert.rejects(run("tree"));
    await assert.rejects(run("link", { path: "snap/ACME/project.docx" }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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
