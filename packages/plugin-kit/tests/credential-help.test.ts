import { describe, expect, it } from "vitest";
import type { CredentialHelp } from "../src/credential-help.js";
import {
  resolveCredentialHelp,
  sanitizeCredentialHelpUrl,
} from "../src/credential-help.js";

const GITLAB: CredentialHelp = {
  kind: "personal-access-token",
  label: "GitLab personal access token",
  obtain: {
    url: "https://gitlab.com/-/user_settings/personal_access_tokens",
    label: "Create token",
  },
  docs: {
    url: "https://docs.gitlab.com/user/profile/personal_access_tokens/",
  },
  instructions: "Open the token page.\nCreate a read-only token.",
  scopes: ["read_api", "read_user"],
};

describe("sanitizeCredentialHelpUrl", () => {
  it("keeps https addresses and normalizes them", () => {
    expect(sanitizeCredentialHelpUrl("  https://example.com/tokens  ")).toBe(
      "https://example.com/tokens",
    );
  });

  it("refuses schemes that can execute or reach the file system", () => {
    for (const url of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "vbscript:msgbox(1)",
    ]) {
      expect(sanitizeCredentialHelpUrl(url)).toBeUndefined();
    }
  });

  it("refuses addresses that carry a credential or no host", () => {
    expect(
      sanitizeCredentialHelpUrl("https://user:secret@example.com/tokens"),
    ).toBeUndefined();
    expect(sanitizeCredentialHelpUrl("not a url")).toBeUndefined();
    expect(sanitizeCredentialHelpUrl("   ")).toBeUndefined();
  });

  it("keeps plain http only for loopback, private and self-hosted hosts", () => {
    expect(sanitizeCredentialHelpUrl("http://localhost:8080/tokens")).toBe(
      "http://localhost:8080/tokens",
    );
    expect(sanitizeCredentialHelpUrl("http://127.0.0.1/tokens")).toBe(
      "http://127.0.0.1/tokens",
    );
    expect(sanitizeCredentialHelpUrl("http://192.168.24.10/tokens")).toBe(
      "http://192.168.24.10/tokens",
    );
    expect(
      sanitizeCredentialHelpUrl("http://gitlab.example.internal/tokens"),
    ).toBe("http://gitlab.example.internal/tokens");
    expect(
      sanitizeCredentialHelpUrl("http://example.com/tokens"),
    ).toBeUndefined();
    // The operator stated the service is self-hosted, so the host is not judged.
    expect(
      sanitizeCredentialHelpUrl("http://example.com/tokens", {
        selfHosted: true,
      }),
    ).toBe("http://example.com/tokens");
  });
});

describe("resolveCredentialHelp", () => {
  it("has nothing to say when the integration declares no metadata", () => {
    expect(resolveCredentialHelp(undefined, undefined)).toEqual({
      help: null,
      problems: [],
    });
  });

  it("returns the declared metadata unchanged without an override", () => {
    const { help, problems } = resolveCredentialHelp(GITLAB);
    expect(problems).toEqual([]);
    expect(help).toEqual(GITLAB);
  });

  it("replaces the addresses, wording and permissions of a deployment", () => {
    const { help, problems } = resolveCredentialHelp(GITLAB, {
      obtainUrl: "https://gitlab.example.internal/-/user_settings/tokens",
      obtainLabel: "Выпустить токен",
      docsUrl: "https://wiki.example.internal/dsh/gitlab",
      docsLabel: "Инструкция",
      instructions: "Откройте внутреннюю страницу токенов.",
      scopes: ["read_api"],
      selfHosted: true,
    });
    expect(problems).toEqual([]);
    expect(help?.obtain).toEqual({
      url: "https://gitlab.example.internal/-/user_settings/tokens",
      label: "Выпустить токен",
    });
    expect(help?.docs).toEqual({
      url: "https://wiki.example.internal/dsh/gitlab",
      label: "Инструкция",
    });
    expect(help?.instructions).toBe("Откройте внутреннюю страницу токенов.");
    expect(help?.scopes).toEqual(["read_api"]);
    expect(help?.selfHosted).toBe(true);
    // The credential mechanism is the integration's own statement.
    expect(help?.kind).toBe("personal-access-token");
    expect(help?.label).toBe("GitLab personal access token");
  });

  it("hides an address the override broke instead of failing the integration", () => {
    const { help, problems } = resolveCredentialHelp(GITLAB, {
      obtainUrl: "javascript:alert(1)",
    });
    expect(help?.obtain).toBeUndefined();
    expect(help?.docs).toEqual(GITLAB.docs);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("obtainUrl");
  });

  it("hides a declared address that is not usable either", () => {
    const { help, problems } = resolveCredentialHelp({
      ...GITLAB,
      docs: { url: "data:text/html,x" },
    });
    expect(help?.docs).toBeUndefined();
    expect(help?.obtain).toEqual(GITLAB.obtain);
    expect(problems).toEqual([
      "docsUrl is not a usable http(s) address: declared help",
    ]);
  });

  it("turns the whole help off when the deployment says so", () => {
    expect(resolveCredentialHelp(GITLAB, { enabled: false })).toEqual({
      help: null,
      problems: [],
    });
  });

  it("never invents metadata an override cannot describe", () => {
    expect(
      resolveCredentialHelp(undefined, { obtainUrl: "https://x.test/y" }),
    ).toEqual({ help: null, problems: [] });
    const { help } = resolveCredentialHelp(undefined, { kind: "oauth" });
    expect(help).toEqual({ kind: "oauth" });
  });

  it("keeps a locale key so the UI can translate the instructions", () => {
    const { help } = resolveCredentialHelp({
      kind: "api-key",
      instructionsLocaleKey: "integration.example.credentials.instructions",
    });
    expect(help?.instructionsLocaleKey).toBe(
      "integration.example.credentials.instructions",
    );
  });

  it("degrades an unknown mechanism instead of rendering an empty label", () => {
    const { help, problems } = resolveCredentialHelp(
      { kind: "api-key", obtain: { url: "https://example.com/keys" } },
      { kind: "kerberos" as never },
    );
    expect(help?.kind).toBe("custom");
    expect(problems).toEqual([
      "kind is not a known credential mechanism: kerberos",
    ]);
  });
});
