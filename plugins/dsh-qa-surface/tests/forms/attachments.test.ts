import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  QaFormAttachmentAdapter,
  validateFormFile,
  type QaFormHostAttachments,
} from "../../src/forms/attachments.js";
import { fixture, intake } from "./fixture.js";
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.splice(0)) f();
});
function setup() {
  const f = fixture();
  cleanup.push(() => f.close());
  const bytes = new Map<string, Buffer>();
  const ref = (data: Uint8Array, name: string) => ({
    attachmentId: `sha256:${createHash("sha256").update(data).digest("hex")}`,
    name,
    bytes: data.length,
  });
  const host: QaFormHostAttachments = {
    root: process.platform === "win32" ? "C:/attachments" : "/attachments",
    readFileStream: async function* (file) {
      const b = bytes.get(file.attachmentId);
      if (!b) throw new Error("missing");
      yield b;
    },
    saveFile: async ({ data, name }) => {
      const r = ref(data, name);
      bytes.set(r.attachmentId, Buffer.from(data));
      return r;
    },
    fileHostPath: (file) =>
      `${process.platform === "win32" ? "C:" : ""}/attachments/${file.attachmentId.slice(7)}/${file.name}`,
  };
  const adapter = new QaFormAttachmentAdapter(
    () => f.service,
    () => host,
  );
  const record = f.service.create("chat-a", "intake", intake);
  const begin = (
    item: string,
    data: string,
    target?: { attachment_id: string; version: number },
  ) => {
    const r = f.command(record.id, {
      action: "begin_upload",
      item_id: item,
      name: item === "equipment" ? "equipment.csv" : "task.txt",
      size_bytes: Buffer.byteLength(data),
      ...(target ? { target } : {}),
    });
    return r.uploads.at(-1)!;
  };
  const complete = async (id: string, data: string, auth = () => {}) => {
    const u = f.service
      .get("chat-a", record.id)
      .uploads.find((v) => v.id === id)!;
    const b = Buffer.from(data),
      file = ref(b, u.name);
    bytes.set(file.attachmentId, b);
    return adapter.complete(
      "chat-a",
      record.id,
      id,
      { receiptId: "server-receipt", file },
      new AbortController().signal,
      auth,
    );
  };
  const upload = async (
    item: string,
    data: string,
    target?: { attachment_id: string; version: number },
  ) => {
    const u = begin(item, data, target);
    adapter.claim("chat-a", u.id);
    return complete(u.id, data);
  };
  return { ...f, f, record, adapter, bytes, host, begin, complete, upload };
}

describe("form attachment protocol", () => {
  it("retains exact versions, replaces atomically, submits with one optional empty item and restores after restart", async () => {
    const t = setup(),
      { f, record } = t;
    const first = await t.upload("task", "first document"),
      old = first.attachments.task![0]!;
    const intent = t.begin("task", "new document", {
      attachment_id: old.attachment_id,
      version: 1,
    });
    t.adapter.claim("chat-a", intent.id);
    expect(f.service.get("chat-a", record.id).attachments.task).toEqual([old]);
    const replaced = await t.complete(intent.id, "new document");
    expect(replaced.attachments.task![0]!.version).toBe(2);
    expect(
      Buffer.from(f.store.resource(record.id, old.resource_id)).toString(),
    ).toBe("first document");
    await t.upload("equipment", "name,quantity\nDemo,2");
    f.command(record.id, {
      action: "save",
      answers: {
        task: { type: "textarea", text: "Задача проекта" },
        modules: { type: "multi_select", selected: ["alpha"] },
      },
      step: 2,
    });
    const snapshot = f.command(record.id, { action: "submit" }).submission!;
    expect(snapshot.empty_optional_item_ids).toEqual(["additional"]);
    f.restart();
    t.bytes.clear();
    const projected = await t.adapter.readable(snapshot);
    const resource = projected.resources[0]!;
    expect(resource.read_path).toContain("/attachments/");
    const current = snapshot.items[0]!.files[0]!;
    expect(t.bytes.get(`sha256:${current.sha256}`)?.toString()).toBe(
      "new document",
    );
  });
  it("keeps v1 after failed replacement; unresolved failure blocks submit until explicitly removed", async () => {
    const t = setup(),
      r = await t.upload("task", "first"),
      old = r.attachments.task![0]!;
    const u = t.begin("task", "broken", {
      attachment_id: old.attachment_id,
      version: 1,
    });
    t.adapter.claim("chat-a", u.id);
    t.adapter.fail("chat-a", r.id, u.id);
    expect(t.f.service.get("chat-a", r.id).attachments.task).toEqual([old]);
    expect(
      t.f.service
        .view(t.f.service.get("chat-a", r.id))
        .field_errors.some((e) => e.code === "UPLOAD_UNRESOLVED"),
    ).toBe(true);
    t.f.command(r.id, { action: "cancel_upload", upload_id: u.id });
    expect(
      t.f.service
        .view(t.f.service.get("chat-a", r.id))
        .field_errors.some((e) => e.code === "UPLOAD_UNRESOLVED"),
    ).toBe(false);
  });
  it("rejects late completion, foreign intents, foreign receipts and duplicate content", async () => {
    const t = setup(),
      r = await t.upload("task", "same");
    const u = t.begin("task", "same");
    t.adapter.claim("chat-a", u.id);
    await expect(t.complete(u.id, "same")).rejects.toThrow(/same file/u);
    t.adapter.fail("chat-a", r.id, u.id);
    const next = t.begin("task", "later");
    t.adapter.claim("chat-a", next.id);
    t.f.command(r.id, { action: "cancel_upload", upload_id: next.id });
    await expect(t.complete(next.id, "later")).rejects.toThrow(/active/u);
    expect(() => t.adapter.claim("chat-b", next.id)).toThrow(/access/u);
    const malformed = t.begin("task", "fake");
    t.adapter.claim("chat-a", malformed.id);
    await expect(
      t.adapter.complete(
        "chat-a",
        r.id,
        malformed.id,
        { receiptId: "fake", file: { path: "/arbitrary" } },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow(/unsupported upload receipt/u);
  });
  it("refuses revoke, false size, duplicate claim and parallel replacement of one base version", async () => {
    const t = setup(),
      r = await t.upload("task", "first"),
      old = r.attachments.task![0]!;
    const u = t.begin("task", "new", {
      attachment_id: old.attachment_id,
      version: 1,
    });
    t.adapter.claim("chat-a", u.id);
    expect(() =>
      t.begin("task", "other", {
        attachment_id: old.attachment_id,
        version: 1,
      }),
    ).toThrow(/already being replaced/u);
    expect(() => t.adapter.claim("chat-a", u.id)).toThrow(/pending/u);
    await expect(
      t.complete(u.id, "new", () => {
        throw new Error("revoked");
      }),
    ).rejects.toThrow("revoked");
    await expect(t.complete(u.id, "too many bytes")).rejects.toThrow(
      /reserved size/u,
    );
    expect(t.f.service.get("chat-a", r.id).attachments.task).toEqual([old]);
  });
  it("finalizes against the current revision after unrelated answer edits", async () => {
    const t = setup(),
      u = t.begin("task", "data");
    t.adapter.claim("chat-a", u.id);
    t.f.command(t.record.id, {
      action: "save",
      answers: { task: { type: "textarea", text: "Edited" } },
      step: 0,
    });
    const r = await t.complete(u.id, "data");
    expect(r.answers.task).toEqual({ type: "textarea", text: "Edited" });
    expect(r.attachments.task).toHaveLength(1);
  });
  it("rolls back resource bytes and binding together on a commit failure", async () => {
    const t = setup(),
      u = t.begin("task", "data");
    t.adapter.claim("chat-a", u.id);
    const put = vi.spyOn(t.f.store, "put").mockImplementationOnce(() => {
      throw new Error("commit failed");
    });
    await expect(t.complete(u.id, "data")).rejects.toThrow("commit failed");
    put.mockRestore();
    expect(t.f.store.storedBytes("chat-a")).toBe(0);
    expect(
      t.f.service.get("chat-a", t.record.id).attachments.task,
    ).toBeUndefined();
  });
  it("restores interrupted operations as failed without treating them as ready", () => {
    const t = setup(),
      u = t.begin("task", "data");
    t.adapter.claim("chat-a", u.id);
    t.f.restart();
    const r = t.f.service.get("chat-a", t.record.id);
    expect(r.uploads[0]!.state).toBe("failed");
    expect(r.attachments.task).toBeUndefined();
  });
  it("enforces all quota reservations, none, empty files, and updated policy", () => {
    const t = setup();
    expect(() => t.begin("modules", "data")).toThrow(/not allowed/u);
    expect(() => t.begin("task", "")).toThrow();
    t.f.policy({ maxTotalFileBytesPerForm: 5 });
    t.begin("task", "1234");
    expect(() => t.begin("task", "1234")).toThrow(/quota/u);
  });
});
describe("file content checks", () => {
  it.each([".pdf", ".docx", ".xlsx", ".png", ".jpg", ".jpeg"])(
    "rejects disguised content %s",
    (ext) => {
      expect(() =>
        validateFormFile(`demo${ext}`, Buffer.from("not this format")),
      ).toThrow();
    },
  );
  it("rejects binary/invalid UTF-8 text, empty files and unsupported formats", () => {
    for (const bytes of [Buffer.from([0]), Buffer.from([255]), Buffer.alloc(0)])
      expect(() => validateFormFile("demo.txt", bytes)).toThrow();
    expect(() => validateFormFile("demo.exe", Buffer.from("data"))).toThrow();
    expect(validateFormFile("demo.csv", Buffer.from("a,b\n1,2"))).toBe(
      "text/csv",
    );
  });
});
