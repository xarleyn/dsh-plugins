import { describe, expect, it } from "vitest";
import { asQaPrincipalSurface } from "../src/host/qa-principal.js";

describe("qa principal surface", () => {
  it("accepts a service that answers for a session", () => {
    const surface = asQaPrincipalSurface({
      principalForSession: (sessionId: string) =>
        sessionId === "chat-1" ? { userId: "user-a" } : undefined,
    });
    expect(surface?.principalForSession("chat-1")).toEqual({
      userId: "user-a",
    });
    expect(surface?.principalForSession("chat-2")).toBeUndefined();
  });

  it("reads a deployment without the surface as no accounts", () => {
    expect(asQaPrincipalSurface(undefined)).toBeUndefined();
    expect(asQaPrincipalSurface(null)).toBeUndefined();
    expect(asQaPrincipalSurface("qaSurface")).toBeUndefined();
    expect(asQaPrincipalSurface({})).toBeUndefined();
    expect(
      asQaPrincipalSurface({ principalForToken: () => ({ userId: "user-a" }) }),
    ).toBeUndefined();
  });

  it("carries the model policy a newer surface answers with", () => {
    const surface = asQaPrincipalSurface({
      principalForSession: () => undefined,
      modelPolicyForSession: (sessionId: string) =>
        sessionId === "chat-1"
          ? { provider: "local", model: "small", reasoningEffort: "low" }
          : undefined,
    });
    expect(surface?.modelPolicyForSession?.("chat-1")).toEqual({
      provider: "local",
      model: "small",
      reasoningEffort: "low",
    });
    // A surface installed before roles had opinions about models still resolves
    // principals; it simply answers nothing about models.
    const older = asQaPrincipalSurface({
      principalForSession: () => ({ userId: "user-a" }),
    });
    expect(older?.modelPolicyForSession).toBeUndefined();
    expect(older?.principalForSession("chat-1")).toEqual({ userId: "user-a" });
  });
});
