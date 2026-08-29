import { describe, expect, it } from "vitest";
import { snapshotFilename, assertPluginGeneratedFilename } from "../../src/snapshots/naming.js";
import { buildSnapshotIdentity, isIdentityCompatible, deriveServerInstanceKey } from "../../src/snapshots/fingerprint.js";
import { KvInvariantError } from "../../src/errors.js";

function identity(sessionId = "session-a", model = "qwen-test") {
  return buildSnapshotIdentity({
    sessionId,
    route: { provider: "local-qwen", model },
    baseURL: "http://127.0.0.1:8080",
    runtimeKey: null,
  });
}

describe("snapshot filenames (SPEC §16, §44, Invariant 9)", () => {
  it("are opaque fixed-length hex names", () => {
    const name = snapshotFilename(identity());
    expect(name).toMatch(/^[0-9a-f]{64}\.bin$/);
  });

  it("are deterministic per identity", () => {
    expect(snapshotFilename(identity())).toBe(snapshotFilename(identity()));
  });

  it("differ per session, model, provider, and server instance", () => {
    const a = snapshotFilename(identity("session-a"));
    const b = snapshotFilename(identity("session-b"));
    const c = snapshotFilename(identity("session-a", "other-model"));
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    const moved = buildSnapshotIdentity({
      sessionId: "session-a",
      route: { provider: "local-qwen", model: "qwen-test" },
      baseURL: "http://192.168.1.42:8080",
      runtimeKey: null,
    });
    expect(snapshotFilename(moved)).not.toBe(a);
  });

  it("guard rejects non-plugin shapes including traversal attempts", () => {
    expect(() => assertPluginGeneratedFilename(snapshotFilename(identity()))).not.toThrow();
    expect(() => assertPluginGeneratedFilename("../../etc/passwd")).toThrowError(KvInvariantError);
    expect(() => assertPluginGeneratedFilename("C:\\whatever.bin")).toThrowError(KvInvariantError);
    expect(() => assertPluginGeneratedFilename("session-a.bin")).toThrowError(KvInvariantError);
    expect(() => assertPluginGeneratedFilename("../../../foo.bin")).toThrowError(KvInvariantError);
  });
});

describe("runtime identity compatibility (SPEC §13-§15, Invariant 4)", () => {
  it("is compatible with itself", () => {
    expect(isIdentityCompatible(identity(), identity())).toBe(true);
  });

  it("breaks when the runtimeKey escape hatch changes", () => {
    const changed = buildSnapshotIdentity({
      sessionId: "session-a",
      route: { provider: "local-qwen", model: "qwen-test" },
      baseURL: "http://127.0.0.1:8080",
      runtimeKey: "qwen38-v2",
    });
    expect(isIdentityCompatible(identity(), changed)).toBe(false);
  });

  it("breaks when provider or model changes (SPEC §56)", () => {
    const otherModel = buildSnapshotIdentity({
      sessionId: "session-a",
      route: { provider: "local-qwen", model: "other" },
      baseURL: "http://127.0.0.1:8080",
      runtimeKey: null,
    });
    const otherProvider = buildSnapshotIdentity({
      sessionId: "session-a",
      route: { provider: "local-coder", model: "qwen-test" },
      baseURL: "http://127.0.0.1:8080",
      runtimeKey: null,
    });
    expect(isIdentityCompatible(identity(), otherModel)).toBe(false);
    expect(isIdentityCompatible(identity(), otherProvider)).toBe(false);
  });

  it("derives a stable server instance key from the endpoint origin", () => {
    expect(deriveServerInstanceKey("http://127.0.0.1:8080")).toBe(
      deriveServerInstanceKey("http://127.0.0.1:8080/v1"),
    );
    expect(deriveServerInstanceKey("http://127.0.0.1:8080")).not.toBe(
      deriveServerInstanceKey("http://127.0.0.1:8081"),
    );
  });
});
