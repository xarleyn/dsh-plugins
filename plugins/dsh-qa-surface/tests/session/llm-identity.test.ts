import { Context } from "@deepseek-ai/cordis";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { QaLlmIdentity } from "../../src/llm-identity.js";
import { QaSessionOwnership } from "../../src/session-ownership.js";
import { QaAccounts } from "../../src/accounts/store.js";

const contexts: Context[] = [];
const stores: QaAccounts[] = [];
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
  for (const accounts of stores.splice(0)) accounts.close();
});

function fixture() {
  const ctx = new Context();
  contexts.push(ctx);
  const file = path.join(
    mkdtempSync(path.join(tmpdir(), "qa-llm-id-")),
    "accounts.db",
  );
  const options = { sessionTtlDays: 30, allowRegistration: true };
  const accounts = new QaAccounts(file, options);
  stores.push(accounts);
  const first = accounts.register("owner-one@example.test", "password-demo-1");
  const second = accounts.register("owner-two@example.test", "password-demo-2");
  accounts.reserveSession(first.token, "chat-one");
  accounts.reserveSession(first.token, "chat-one-more");
  accounts.reserveSession(second.token, "chat-two");
  const attested = new Set(["chat-one", "chat-one-more", "chat-two"]);
  const ownership = new QaSessionOwnership((id) => attested.has(id));
  ownership.install(ctx);
  const identity = new QaLlmIdentity(ctx, {
    rootOf: (id) => ownership.rootOf(id),
    accounts: () => accounts,
  });
  return {
    ctx,
    accounts,
    file,
    options,
    first,
    second,
    attested,
    ownership,
    identity,
  };
}

describe("QA LLM owner identity", () => {
  it("publishes a runtime seam with stable opaque IDs per active owner", () => {
    const { ctx, identity, file, options, first, second } = fixture();
    expect(ctx.get("qaLlmIdentity").forSession("chat-one")).toBe(
      identity.forSession("chat-one"),
    );
    const firstId = identity.forSession("chat-one");
    expect(firstId).toMatch(/^qa_u_[a-f0-9]{64}$/u);
    expect(identity.forSession("chat-one-more")).toBe(firstId);
    expect(identity.forSession("chat-two")).not.toBe(firstId);
    for (const value of [first.user.id, second.user.id, first.user.email])
      expect(firstId).not.toContain(value);
    const restartedContext = new Context();
    contexts.push(restartedContext);
    const reopenedAccounts = new QaAccounts(file, options);
    stores.push(reopenedAccounts);
    const restarted = new QaLlmIdentity(restartedContext, {
      rootOf: (id) => (id === "chat-one" ? id : undefined),
      accounts: () => reopenedAccounts,
    });
    expect(restarted.forSession("chat-one")).toBe(firstId);
  });

  it("inherits only live delegated children recorded by the verified ownership seam", () => {
    const { ctx, identity, attested } = fixture();
    const created = (
      id: string,
      parent: string,
      isSeeded = false,
      origin = "subagent",
    ) =>
      ctx.emit("session/created", {
        id,
        header: { parentSession: parent, isSeeded, origin },
      } as never);
    created("child", "chat-one");
    created("grandchild", "child");
    created("restored-child", "chat-one", true);
    created("imported", "chat-one", true, "import");
    created("foreign-child", "unattested");
    expect(identity.forSession("child")).toBe(identity.forSession("chat-one"));
    expect(identity.forSession("grandchild")).toBe(
      identity.forSession("chat-one"),
    );
    expect(identity.forSession("restored-child")).toBe(
      identity.forSession("chat-one"),
    );
    expect(identity.forSession("imported")).toBeUndefined();
    expect(identity.forSession("foreign-child")).toBeUndefined();
    attested.delete("chat-one");
    expect(identity.forSession("child")).toBeUndefined();
    expect(identity.forSession("grandchild")).toBeUndefined();
  });

  it("refuses unowned, unattested and disabled accounts and rechecks current ownership", () => {
    const { identity, accounts, first, second, attested } = fixture();
    attested.add("unowned");
    expect(identity.forSession("unowned")).toBeUndefined();
    attested.delete("chat-one-more");
    expect(identity.forSession("chat-one-more")).toBeUndefined();
    const otherId = identity.forSession("chat-two");
    accounts.setUserDisabled(first.user.email, true);
    expect(identity.forSession("chat-one")).toBeUndefined();
    expect(identity.forSession("chat-two")).toBe(otherId);
    accounts.setUserDisabled(first.user.email, false);
    expect(identity.forSession("chat-one")).toBeDefined();
    expect(accounts.accountById(second.user.id)).toBeDefined();
  });
});
