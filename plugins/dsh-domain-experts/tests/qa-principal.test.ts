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
});
