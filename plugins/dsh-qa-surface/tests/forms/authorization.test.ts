import { afterEach, describe, expect, it, vi } from "vitest";
import { QaSurface } from "../../src/index.js";
import { sharingFixture } from "../session/chat-sharing.helpers.js";
import { fixture, textOnly } from "./fixture.js";
const closes: (() => void)[] = [];
afterEach(() => {
  for (const close of closes.splice(0)) close();
});
function setup() {
  const auth = sharingFixture(),
    f = fixture();
  closes.push(() => {
    f.close();
    auth.store.storage.close();
    auth.accounts.close();
  });
  const r = f.service.create("chat-a", "intake", textOnly);
  const surface = Object.create(QaSurface.prototype) as QaSurface;
  const notify = vi.fn();
  Object.assign(surface, {
    getConfig: () => ({
      accounts: { enabled: true },
      forms: { enabled: true },
    }),
    sharing: () => auth.store,
    secureSession: vi.fn(async () => {}),
    forms: () => f.service,
    formGate: { waiting: () => false, touch: vi.fn(), notify },
  });
  return { auth, f, r, surface, notify };
}
describe("form remote authorization", () => {
  it.each(["reader", "collaborator", "outsider"] as const)(
    "does not expose schema, draft, files or mutations to %s",
    async (actor) => {
      const t = setup(),
        token = t.auth[actor].token;
      const requests = [
        t.surface.listForms(token, "chat-a"),
        t.surface.getForm(token, "chat-a", t.r.id),
        t.surface.mutateForm(token, "chat-a", {
          action: "submit",
          form_id: t.r.id,
          expected_revision: 0,
          mutation_id: "send",
        }),
        t.surface.readFormAttachment(token, "chat-a", t.r.id, "foreign"),
      ];
      for (const result of await Promise.all(requests)) {
        expect(result).toEqual({
          ok: false,
          error: {
            code: "ACCESS_DENIED",
            message: "Form access is unavailable.",
          },
        });
        expect(JSON.stringify(result)).not.toContain(t.r.schema.title);
      }
      expect(t.notify).not.toHaveBeenCalled();
    },
  );
  it("checks access again after asynchronous admission and before mutating", async () => {
    const t = setup(),
      actual = t.auth.store.owner.bind(t.auth.store);
    vi.spyOn(t.auth.store, "owner")
      .mockImplementationOnce(actual)
      .mockImplementationOnce(() => {
        throw new Error("revoked");
      });
    const response = await t.surface.mutateForm(t.auth.owner.token, "chat-a", {
      action: "save",
      form_id: t.r.id,
      expected_revision: 0,
      mutation_id: "save",
      answers: { answer: { type: "text", text: "Data" } },
      step: 0,
    });
    expect(response).toMatchObject({
      ok: false,
      error: { code: "ACCESS_DENIED" },
    });
    expect(t.f.service.get("chat-a", t.r.id).revision).toBe(0);
  });
  it("refuses unknown forms and arbitrary resource IDs even to an owner", async () => {
    const t = setup(),
      token = t.auth.owner.token;
    expect(await t.surface.getForm(token, "chat-a", "foreign")).toMatchObject({
      ok: false,
      error: { code: "ACCESS_DENIED" },
    });
    expect(
      await t.surface.readFormAttachment(token, "chat-a", t.r.id, "foreign"),
    ).toMatchObject({ ok: false, error: { code: "ACCESS_DENIED" } });
    expect(await t.surface.getForm(token, "chat-a", t.r.id)).toMatchObject({
      ok: true,
      value: { id: t.r.id },
    });
  });
});
