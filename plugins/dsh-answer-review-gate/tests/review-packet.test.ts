import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, expect, it } from "vitest";
import { expertReviewPacket } from "../src/adapters/review-packet.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "answer-review-packet-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("preserves the full long answer beyond the expert limit and refuses a changed snapshot", async () => {
  const task = `${"Confirmed evidence\n".repeat(1500)}FINAL CANDIDATE MARKER`;
  const packet = await expertReviewPacket(task, root);
  expect(packet.task.length).toBeLessThan(12_000);
  const relative = packet.task.match(/review-packet: ([^\n]+)/u)?.[1];
  expect(relative).toBeDefined();
  const file = path.join(root, relative!);
  expect(await readFile(file, "utf8")).toBe(task);
  await expect(packet.verify()).resolves.toBeUndefined();
  await writeFile(file, "Modified snapshot");
  await expect(packet.verify()).rejects.toMatchObject({
    reason: "review-packet-changed",
  });
});

it("fails instead of silently clipping a long review when its workspace is unavailable", async () => {
  await expect(expertReviewPacket("x".repeat(20_000))).rejects.toMatchObject({
    reason: "review-packet-unavailable",
  });
  const short = await expertReviewPacket("Complete short task");
  expect(short.task).toBe("Complete short task");
});

it("refuses a workspace artifact directory that escapes through a symlink", async () => {
  const cwd = path.join(root, "workspace"),
    outside = path.join(root, "outside");
  await mkdir(cwd);
  await mkdir(outside);
  await symlink(
    outside,
    path.join(cwd, ".qa"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await expect(
    expertReviewPacket("x".repeat(20_000), cwd),
  ).rejects.toMatchObject({ reason: "review-packet-unavailable" });
});
