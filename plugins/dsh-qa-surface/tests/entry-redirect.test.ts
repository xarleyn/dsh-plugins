import { describe, expect, it } from "vitest";
import {
  entryRedirectRow,
  entryRedirectScript,
} from "../src/entry-redirect.js";
import { resolveConfig } from "../src/resolve-config.js";

describe("QA entry redirect", () => {
  it("builds a guarded head script for the default config", () => {
    const config = resolveConfig();
    const row = entryRedirectRow(config);
    expect(row).toMatchObject({ kind: "script", placement: "head" });
    const script = entryRedirectScript(config);
    // Marker guard: the /qa navigation hand-off must never bounce.
    expect(script).toContain('"__dsh_qa_route"');
    expect(script).toContain('s.has("__dsh_qa_route")');
    // The operator escape hatch and its persistence.
    expect(script).toContain("ui==='admin'");
    expect(script).toContain("ui==='qa'");
    expect(script).toContain(":entry-ui");
    // Loopback hostnames stay on the harness root.
    expect(script).toContain("h==='localhost'");
    expect(script).toContain("h==='127.0.0.1'");
    expect(script).toContain("\\.localhost$");
    // Everyone else continues into the QA route.
    expect(script).toContain('location.replace("/qa")');
    // The row is a self-defending classic script, safe for one-line injection.
    expect(script).not.toContain("</script");
    expect(script.startsWith("(function(){try{")).toBe(true);
  });

  it("follows the configured route path and the disable flag", () => {
    const configured = resolveConfig({
      route: { path: "/assistant", matchChildren: true },
      session: { storageKey: "custom-key" },
    });
    const script = entryRedirectScript(configured);
    expect(script).toContain('location.replace("/assistant")');
    expect(script).toContain("custom-key:v1:/assistant:entry-ui");
    expect(entryRedirectRow({ ...configured, enabled: false })).toBeUndefined();
    expect(
      entryRedirectRow({
        ...configured,
        entry: { redirectNonLoopback: false, cookieBootstrap: true },
      }),
    ).toBeUndefined();
  });
});
