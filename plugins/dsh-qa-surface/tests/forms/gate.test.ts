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
function setup() {
  const f = fixture();
  cleanup.push(() => f.close());
  let allowed = true,
    busy = false;
  const gate = new QaFormGate(
    () => f.service,
    (id) => (id === "chat-a" ? id : id === "child" ? "chat-a" : undefined),
    () => busy,
    () => allowed,
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
      /Open this chat/u,
    );
    headless.dispose();
  });
});
