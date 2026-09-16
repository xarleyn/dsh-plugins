import { QaIntegrationPrincipalBindings } from "../src/integration-principals.js";

describe("QA integration principal bindings", () => {
  it("binds only an owner-attested root session", () => {
    const bindings = new QaIntegrationPrincipalBindings();
    bindings.attest("alice-chat", "alice", "alice");
    expect(bindings.resolve("alice-chat", "alice")).toEqual({
      userId: "alice",
    });
    expect(bindings.resolve("alice-chat", "bob")).toBeUndefined();
    expect(bindings.resolve("unowned", undefined)).toBeUndefined();
  });

  it("revokes the binding when an admin views another user's chat", () => {
    const bindings = new QaIntegrationPrincipalBindings();
    bindings.attest("bob-chat", "bob", "bob");
    bindings.attest("bob-chat", "admin", "bob");
    expect(bindings.resolve("bob-chat", "bob")).toBeUndefined();
  });

  it("does not inherit a root binding into a child session", () => {
    const bindings = new QaIntegrationPrincipalBindings();
    bindings.attest("root", "alice", "alice");
    expect(bindings.resolve("child", undefined)).toBeUndefined();
  });
});
