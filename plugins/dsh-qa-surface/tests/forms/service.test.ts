import { afterEach, describe, expect, it, vi } from "vitest";
import { fixture, intake, textOnly } from "./fixture.js";
import { fingerprint } from "../../src/forms/store.js";
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.splice(0)) f();
});
function setup() {
  const f = fixture();
  cleanup.push(() => f.close());
  return f;
}

describe("durable form state", () => {
  it("creates idempotently, detects schema conflict, refuses parallel drafts and foreign sessions", () => {
    const f = setup(),
      r = f.service.create("chat-a", "intake", textOnly);
    expect(f.service.create("chat-a", "intake", textOnly).id).toBe(r.id);
    expect(() =>
      f.service.create("chat-a", "intake", { ...textOnly, title: "Other" }),
    ).toThrow(/different requirements/u);
    expect(() => f.service.create("chat-a", "another", textOnly)).toThrow(
      /Resume/u,
    );
    expect(() => f.service.get("chat-b", r.id)).toThrow(/access/u);
  });
  it("refuses fabricated readiness, unknown fields, unsaved required data and skipped steps", () => {
    const f = setup(),
      r = f.service.create("chat-a", "intake", intake);
    for (const action of [
      { action: "submit" },
      { action: "submit", complete: true },
      { action: "save", answers: {}, step: 2 },
      { action: "save", answers: { foreign: null }, step: 0 },
    ])
      expect(() => f.command(r.id, action)).toThrow();
    expect(f.service.get("chat-a", r.id).status).toBe("draft");
  });
  it("replays identical mutations before stale-revision checking, but rejects key reuse", () => {
    const f = setup(),
      r = f.service.create("chat-a", "intake", textOnly);
    const c = {
      action: "save" as const,
      form_id: r.id,
      expected_revision: 0,
      mutation_id: "save_a",
      answers: { answer: { type: "text", text: "Задача" } },
      step: 0,
    };
    const saved = f.service.command("chat-a", c);
    expect(f.service.command("chat-a", c)).toEqual(saved);
    expect(() => f.service.command("chat-a", { ...c, answers: {} })).toThrow(
      /different data/u,
    );
    expect(() =>
      f.service.command("chat-a", { ...c, mutation_id: "save_b" }),
    ).toThrow(/another window/u);
  });
  it("recovers drafts and immutable submissions and returns the same submission after retry", () => {
    const f = setup(),
      r = f.service.create("chat-a", "intake", textOnly);
    f.command(r.id, {
      action: "save",
      answers: { answer: { type: "text", text: "Задача" } },
      step: 0,
    });
    f.restart();
    expect(f.service.get("chat-a", r.id).answers.answer).toEqual({
      type: "text",
      text: "Задача",
    });
    const submitted = f.command(r.id, { action: "submit" });
    f.restart();
    expect(f.command(r.id, { action: "submit" }).submission).toEqual(
      submitted.submission,
    );
    expect(f.service.create("chat-a", "intake", textOnly).submission).toEqual(
      submitted.submission,
    );
    expect(() =>
      f.command(r.id, { action: "save", answers: {}, step: 0 }),
    ).toThrow(/cannot be edited/u);
  });
  it("rolls back status, revision and mutation receipt if commit work fails", () => {
    const f = setup(),
      r = f.service.create("chat-a", "intake", textOnly);
    f.command(r.id, {
      action: "save",
      answers: { answer: { type: "text", text: "Задача" } },
      step: 0,
    });
    const put = vi.spyOn(f.store, "put").mockImplementationOnce(() => {
      throw new Error("injected write failure");
    });
    expect(() => f.command(r.id, { action: "submit" })).toThrow("injected");
    put.mockRestore();
    expect(f.service.get("chat-a", r.id).status).toBe("draft");
    expect(
      f.command(r.id, { action: "submit" }).submission?.submission_id,
    ).toBeTruthy();
  });
  it("preserves answers on pause and refuses mutations while disabled", () => {
    const f = setup(),
      r = f.service.create("chat-a", "intake", textOnly);
    expect(f.command(r.id, { action: "pause" }).status).toBe("draft");
    f.policy({ enabled: false });
    expect(() => f.command(r.id, { action: "submit" })).toThrow(/disabled/u);
    expect(f.service.get("chat-a", r.id).status).toBe("draft");
  });
  it("normalizes object key order for stable schema identity", () => {
    expect(fingerprint({ b: 2, a: 1 })).toBe(fingerprint({ a: 1, b: 2 }));
  });
});
