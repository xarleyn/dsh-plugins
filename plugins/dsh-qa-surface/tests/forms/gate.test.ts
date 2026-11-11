import { afterEach, describe, expect, it } from "vitest";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import type { Context } from "@deepseek-ai/cordis";
import { QaFormGate } from "../../src/forms/gate.js";
import { createRequestUserFormTool } from "../../src/qa-tools/request-user-form.js";
import {
  createQaToolCatalog,
  qaToolNames,
} from "../../src/qa-tools/catalog.js";
import { fixture, intake, textOnly } from "./fixture.js";
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.splice(0)) f();
});
function setup(filesAvailable = false) {
  const f = fixture();
  cleanup.push(() => f.close());
  let allowed = true,
    busy = false;
  const gate = new QaFormGate(
    () => f.service,
    (id) => (id === "chat-a" ? id : id === "child" ? "chat-a" : undefined),
    () => busy,
    () => allowed,
    () => filesAvailable,
  );
  cleanup.unshift(() => gate.dispose());
  gate.touch("chat-a");
  const abort = new AbortController();
  const exec = (id = "chat-a") =>
    ({
      agent: { session: { id, header: {} } },
      callId: "call-a",
      signal: abort.signal,
    }) as unknown as ToolRunContext;
  return {
    f,
    gate,
    abort,
    exec,
    allowed: (v: boolean) => {
      allowed = v;
    },
    busy: (v: boolean) => {
      busy = v;
    },
  };
}
describe("form tool lifecycle", () => {
  it("validates without a UI poll, waiter, request_key or saved form", async () => {
    const t = setup();
    const headless = new QaFormGate(
      () => t.f.service,
      (id) => id,
      () => false,
      () => true,
    );
    cleanup.unshift(() => headless.dispose());
    const tool = createRequestUserFormTool(headless);
    expect(
      await tool.execute({ action: "validate", form: textOnly }, t.exec()),
    ).toMatchObject({
      status: "validated",
      valid: true,
      interactive_client_ready: false,
      file_upload_available: false,
      issues: [],
    });
    expect(t.f.store.list("chat-a")).toHaveLength(0);
    expect(headless.hasSession("chat-a")).toBe(false);
  });
  it("separates invalid schema from unavailable file capabilities without creating a draft", async () => {
    const t = setup();
    const valid = await t.gate.request(
      { action: "validate", form: intake },
      t.exec(),
    );
    expect(valid).toMatchObject({
      status: "validated",
      valid: true,
      file_upload_available: false,
      policy: { allowedExtensions: expect.arrayContaining([".pdf", ".txt"]) },
    });
    const invalid = structuredClone(intake);
    invalid.steps[0]!.items[0]!.files = {
      requirement: "required",
      min_count: 1,
      max_count: 1,
      accept: ["application/pdf"],
      max_file_size_bytes: 1000,
    };
    expect(
      await t.gate.request({ action: "validate", form: invalid }, t.exec()),
    ).toMatchObject({
      status: "validated",
      valid: false,
      issues: [
        expect.objectContaining({
          path: "form.steps[0].items[0].files.accept[0]",
        }),
      ],
    });
    expect(t.f.store.list("chat-a")).toHaveLength(0);
  });
  it("still requires feature and main-agent admission for validation", async () => {
    const t = setup();
    const args = { action: "validate", form: textOnly };
    await expect(t.gate.request(args, t.exec("child"))).rejects.toThrow(
      /main agent/u,
    );
    t.allowed(false);
    await expect(t.gate.request(args, t.exec())).rejects.toThrow(
      /unavailable/u,
    );
    t.allowed(true);
    t.f.policy({ enabled: false });
    await expect(t.gate.request(args, t.exec())).rejects.toThrow(/disabled/u);
  });
  it.each(["optional", "required"] as const)(
    "parks a valid file-only %s form until explicit pause, and validates beside its draft",
    async (requirement) => {
      const t = setup(true);
      const form = structuredClone(textOnly);
      const item = form.steps[0]!.items[0]!;
      delete item.answer;
      item.files = {
        requirement,
        max_count: 1,
        accept: [".txt"],
        max_file_size_bytes: 1000,
        ...(requirement === "required" ? { min_count: 1 } : {}),
      } as typeof item.files;
      const pending = t.gate.request(
        { action: "create", request_key: "files", form },
        t.exec(),
      );
      const r = t.f.store.list("chat-a")[0]!;
      expect(r.status).toBe("draft");
      expect(r.submission).toBeUndefined();
      expect(t.gate.waiting(r.id)).toBe(true);
      expect(
        await t.gate.request({ action: "validate", form }, t.exec()),
      ).toMatchObject({
        status: "validated",
        valid: true,
        file_upload_available: true,
      });
      expect(t.f.store.list("chat-a")).toHaveLength(1);
      if (requirement === "required")
        expect(() => t.f.command(r.id, { action: "submit" })).toThrow(
          /обязательные/u,
        );
      t.gate.notify(t.f.command(r.id, { action: "pause" }), true);
      expect(await pending).toMatchObject({ status: "paused", form_id: r.id });
      expect(t.f.store.get("chat-a", r.id).status).toBe("draft");
    },
  );
  it("validates the real tool schema and returns a structured submission object", async () => {
    const t = setup(),
      tool = createRequestUserFormTool(t.gate);
    const pending = tool.execute(
      { action: "create", request_key: "intake", form: textOnly },
      t.exec(),
    );
    const r = t.f.store.list("chat-a")[0]!;
    t.f.command(r.id, {
      action: "save",
      answers: { answer: { type: "text", text: "Data" } },
      step: 0,
    });
    const submitted = t.f.command(r.id, { action: "submit" });
    t.gate.notify(submitted);
    expect(await pending).toEqual(submitted.submission);
  });
  it("is absent from the default catalog and included only through the activation catalog", () => {
    const t = setup();
    const deps = {
      catalogVersion: "4",
      activationMode: "all",
      catalogTools: () => [],
      activeTools: () => [],
      skillLoaded: () => false,
    };
    expect(qaToolNames(createQaToolCatalog(deps))).not.toContain(
      "request_user_form",
    );
    expect(
      qaToolNames(createQaToolCatalog({ ...deps, forms: t.gate })),
    ).toContain("request_user_form");
  });
  it("releases only after a durable submission and returns that same snapshot on resume", async () => {
    const t = setup(),
      pending = t.gate.request(
        { action: "create", request_key: "intake", form: textOnly },
        t.exec(),
      );
    const r = t.f.store.list("chat-a")[0]!;
    expect(t.gate.waiting(r.id)).toBe(true);
    t.f.command(r.id, {
      action: "save",
      answers: { answer: { type: "text", text: "Data" } },
      step: 0,
    });
    const submitted = t.f.command(r.id, { action: "submit" });
    expect(t.f.store.get("chat-a", r.id).submission).toEqual(
      submitted.submission,
    );
    t.gate.notify(submitted);
    expect(await pending).toEqual(submitted.submission);
    expect(t.gate.waiting(r.id)).toBe(false);
    expect(
      await t.gate.request({ action: "resume", form_id: r.id }, t.exec()),
    ).toEqual(submitted.submission);
  });
  it.each(["abort", "idle", "disposed", "plugin"])(
    "retains draft and never invents success on %s",
    async (ending) => {
      const t = setup(),
        listeners = new Map<string, (value: unknown) => void>();
      t.gate.install({
        on: (name: string, callback: (v: unknown) => void) => {
          listeners.set(name, callback);
          return () => listeners.delete(name);
        },
      } as unknown as Context);
      const pending = t.gate.request(
        { action: "create", request_key: "intake", form: textOnly },
        t.exec(),
      );
      const r = t.f.store.list("chat-a")[0]!;
      const refused = expect(pending).rejects.toBeDefined();
      if (ending === "abort") t.abort.abort(new Error("stopped"));
      else if (ending === "plugin") t.gate.dispose();
      else
        listeners.get(ending === "idle" ? "agent/status" : "agent/disposed")!({
          agent: { session: { id: "chat-a" } },
          status: "idle",
        });
      await refused;
      expect(t.f.store.get("chat-a", r.id).status).toBe("draft");
      expect(t.gate.waiting(r.id)).toBe(false);
    },
  );
  it("pauses without completion and refuses revoked access at wakeup", async () => {
    const t = setup();
    const pending = t.gate.request(
      { action: "create", request_key: "intake", form: textOnly },
      t.exec(),
    );
    const r = t.f.store.list("chat-a")[0]!;
    t.gate.notify(t.f.command(r.id, { action: "pause" }), true);
    expect(await pending).toMatchObject({ status: "paused", form_id: r.id });
    const resumed = t.gate.request(
      { action: "resume", form_id: r.id },
      t.exec(),
    );
    t.allowed(false);
    t.gate.notify(r, true);
    await expect(resumed).rejects.toThrow(/access/u);
  });
  it("fails delegated, unowned, busy, headless and unavailable-file calls without leaving an invisible draft", async () => {
    const t = setup();
    const create = { action: "create", request_key: "intake", form: textOnly };
    await expect(t.gate.request(create, t.exec("child"))).rejects.toThrow(
      /main agent/u,
    );
    await expect(t.gate.request(create, t.exec("other"))).rejects.toThrow(
      /main agent/u,
    );
    t.busy(true);
    await expect(t.gate.request(create, t.exec())).rejects.toThrow(
      /current interactive/u,
    );
    t.busy(false);
    await expect(
      t.gate.request({ ...create, form: intake }, t.exec()),
    ).rejects.toThrow(/pipeline/u);
    expect(t.f.store.list("chat-a")).toHaveLength(0);
    const headless = new QaFormGate(
      () => t.f.service,
      (id) => id,
      () => false,
      () => true,
    );
    await expect(headless.request(create, t.exec())).rejects.toThrow(
      /No recent QA form poll/u,
    );
    headless.dispose();
  });
});
