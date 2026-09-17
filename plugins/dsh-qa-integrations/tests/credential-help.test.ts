/**
 * Credential help: what each provider declares next to its credential field,
 * what a deployment may replace, and the guarantee that none of it carries a
 * secret. The declared addresses are checked for shape only — a unit test must
 * not need the network, and a vendor page that moved must not fail the suite.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Context } from "@deepseek-ai/cordis";
import {
  CREDENTIAL_HELP_KINDS,
  sanitizeCredentialHelpUrl,
  type CredentialHelp,
} from "@yadsh/dsh-plugin-kit";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveConfig,
  type ResolvedQaIntegrationsConfig,
} from "../src/config.js";
import QaIntegrations from "../src/index.js";
import type { IntegrationProvider } from "../src/providers/contract.js";
import { BITRIX24_CREDENTIAL_HELP } from "../src/providers/bitrix24/credential-help.js";
import { Bitrix24Provider } from "../src/providers/bitrix24/index.js";
import { CONFLUENCE_CREDENTIAL_HELP } from "../src/providers/confluence/credential-help.js";
import { ConfluenceProvider } from "../src/providers/confluence/index.js";
import { GITLAB_CREDENTIAL_HELP } from "../src/providers/gitlab/credential-help.js";
import { GitlabProvider } from "../src/providers/gitlab/index.js";
import { JIRA_CREDENTIAL_HELP } from "../src/providers/jira/credential-help.js";
import { JiraProvider } from "../src/providers/jira/index.js";
import { TEAMCITY_CREDENTIAL_HELP } from "../src/providers/teamcity/credential-help.js";
import { TeamcityProvider } from "../src/providers/teamcity/index.js";
import { TESTIT_CREDENTIAL_HELP } from "../src/providers/testit/credential-help.js";
import { TestitProvider } from "../src/providers/testit/index.js";
import { WEBLATE_CREDENTIAL_HELP } from "../src/providers/weblate/credential-help.js";
import { WeblateProvider } from "../src/providers/weblate/index.js";

type Config = ResolvedQaIntegrationsConfig;

/** Every credential help this plugin declares, with the provider that owns it. */
const PROVIDERS: readonly (readonly [
  string,
  CredentialHelp,
  (config: Config) => IntegrationProvider,
])[] = [
  [
    "bitrix24",
    BITRIX24_CREDENTIAL_HELP,
    (config) => new Bitrix24Provider(config),
  ],
  [
    "confluence",
    CONFLUENCE_CREDENTIAL_HELP,
    (config) => new ConfluenceProvider(config),
  ],
  ["gitlab", GITLAB_CREDENTIAL_HELP, (config) => new GitlabProvider(config)],
  ["jira", JIRA_CREDENTIAL_HELP, (config) => new JiraProvider(config)],
  [
    "teamcity",
    TEAMCITY_CREDENTIAL_HELP,
    (config) => new TeamcityProvider(config),
  ],
  ["testit", TESTIT_CREDENTIAL_HELP, (config) => new TestitProvider(config)],
  ["weblate", WEBLATE_CREDENTIAL_HELP, (config) => new WeblateProvider(config)],
];

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch {
      // The store keeps its handle open on Windows; a leftover temp directory
      // is not worth failing a test over.
    }
  }
});

/** Keys that may never appear anywhere in a payload sent to the browser. */
const FORBIDDEN_KEYS = ["token", "secret", "credential", "ciphertext"];

function offendingKey(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = offendingKey(entry);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (value === null || typeof value !== "object") return undefined;
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.includes(key)) return key;
    const found = offendingKey(entry);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The plugin, with QA accounts the remote resolves to principals. */
async function host(
  config: Record<string, unknown> = {},
): Promise<QaIntegrations> {
  const directory = mkdtempSync(path.join(tmpdir(), "qa-integrations-help-"));
  directories.push(directory);
  const ctx = new Context();
  ctx.provide("qaSurface", {
    registerPrincipalScopedTools: () => () => {},
    principalForSession: () => undefined,
    principalForToken: (token: string) =>
      token.startsWith("qa-token-")
        ? { userId: token.slice("qa-token-".length) }
        : undefined,
  } as never);
  ctx.provide("tools", { register: () => () => {} } as never);
  await ctx.plugin(QaIntegrations, {
    enabled: true,
    dataPath: path.join(directory, "qa-integrations.db"),
    masterKeyPath: path.join(directory, "master.key"),
    ...config,
  });
  return ctx.qaIntegrations;
}

describe("credential help declarations", () => {
  it("names a known mechanism and usable addresses, without the network", () => {
    for (const [id, help] of PROVIDERS) {
      expect(CREDENTIAL_HELP_KINDS, id).toContain(help.kind);
      expect(help.label, id).toBeTruthy();
      expect(help.instructions ?? help.instructionsLocaleKey, id).toBeTruthy();
      for (const [field, link] of [
        ["obtain", help.obtain],
        ["docs", help.docs],
      ] as const) {
        if (link === undefined) continue;
        expect(link.label, `${id}.${field}`).toBeTruthy();
        expect(
          sanitizeCredentialHelpUrl(link.url, {
            selfHosted: help.selfHosted === true,
          }),
          `${id}.${field}: ${link.url}`,
        ).toBeDefined();
      }
      for (const list of [help.scopes, help.notes]) {
        for (const entry of list ?? []) {
          expect(entry.trim(), id).toBe(entry);
          expect(entry.trim(), id).not.toBe("");
        }
      }
    }
  });

  it("words the help after each provider's own mechanism", () => {
    const kinds = new Map<string, CredentialHelp["kind"]>(
      PROVIDERS.map(([id, help]) => [id, help.kind]),
    );
    expect(kinds.get("gitlab")).toBe("personal-access-token");
    expect(kinds.get("weblate")).toBe("personal-access-token");
    expect(kinds.get("jira")).toBe("api-key");
    expect(kinds.get("confluence")).toBe("api-key");
    expect(kinds.get("bitrix24")).toBe("custom");
  });
});

describe("credential help resolution", () => {
  it("keeps the declared help when the deployment says nothing", () => {
    for (const [id, help, create] of PROVIDERS) {
      const provider = create(resolveConfig({}));
      expect(provider.credentialHelp, id).toEqual(help);
      expect(provider.credentialHelpProblems ?? [], id).toEqual([]);
    }
  });

  it("replaces addresses, wording and permissions for a self-hosted deployment", () => {
    const provider = new GitlabProvider(
      resolveConfig({
        credentialHelp: {
          gitlab: {
            obtainUrl: "https://gitlab.example.internal/-/user_settings/tokens",
            obtainLabel: "Выпустить токен",
            docsUrl: "https://wiki.example.internal/dsh/gitlab",
            docsLabel: "Инструкция",
            instructions: "Откройте внутреннюю страницу токенов.",
            scopes: ["read_api"],
            selfHosted: true,
          },
        },
      }),
    );
    expect(provider.credentialHelp?.obtain).toEqual({
      url: "https://gitlab.example.internal/-/user_settings/tokens",
      label: "Выпустить токен",
    });
    expect(provider.credentialHelp?.docs).toEqual({
      url: "https://wiki.example.internal/dsh/gitlab",
      label: "Инструкция",
    });
    expect(provider.credentialHelp?.instructions).toBe(
      "Откройте внутреннюю страницу токенов.",
    );
    expect(provider.credentialHelp?.scopes).toEqual(["read_api"]);
    // The mechanism is the integration's statement, not the deployment's.
    expect(provider.credentialHelp?.kind).toBe("personal-access-token");
    expect(provider.credentialHelpProblems).toEqual([]);
  });

  it("turns the help off without touching the credential field", () => {
    const provider = new WeblateProvider(
      resolveConfig({ credentialHelp: { weblate: { enabled: false } } }),
    );
    expect(provider.credentialHelp).toBeNull();
    expect(provider.credentialHelpProblems).toEqual([]);
  });

  it("hides an address the override broke and reports it at startup", () => {
    const provider = new JiraProvider(
      resolveConfig({
        credentialHelp: { jira: { obtainUrl: "javascript:alert(1)" } },
      }),
    );
    expect(provider.credentialHelp?.obtain).toBeUndefined();
    // Everything else the deployment asked for stays as it was.
    expect(provider.credentialHelp?.docs).toEqual(JIRA_CREDENTIAL_HELP.docs);
    expect(provider.credentialHelpProblems).toEqual([
      "obtainUrl is not a usable http(s) address: deployment override",
    ]);
  });

  it("degrades a mechanism it does not know instead of rendering blank", () => {
    // YAML is untyped: the value can reach the resolver without a compiler
    // having seen it, which is the case this guards.
    const provider = new TestitProvider(
      resolveConfig({
        credentialHelp: { testit: { kind: "kerberos" as never } },
      }),
    );
    expect(provider.credentialHelp?.kind).toBe("custom");
    expect(provider.credentialHelpProblems).toEqual([
      "kind is not a known credential mechanism: kerberos",
    ]);
  });

  it("never lets help settings into the provider's own configuration", () => {
    const base = resolveConfig({});
    const overridden = resolveConfig({
      credentialHelp: {
        gitlab: { obtainUrl: "https://example.com/tokens" },
        jira: { enabled: false },
      },
    });
    // Whatever the help says, a provider connects and stores exactly the same.
    for (const [id] of PROVIDERS) {
      expect(overridden[id as keyof ResolvedQaIntegrationsConfig], id).toEqual(
        base[id as keyof ResolvedQaIntegrationsConfig],
      );
    }
  });
});

describe("credential help over the remote", () => {
  it("ships each provider's effective help with the provider list", async () => {
    const service = await host();
    const summaries = service.providers("qa-token-user-1");
    expect(
      summaries.find((entry) => entry.id === "gitlab")?.credentialHelp,
    ).toEqual(GITLAB_CREDENTIAL_HELP);
    expect(
      summaries.find((entry) => entry.id === "bitrix24")?.credentialHelp,
    ).toEqual(BITRIX24_CREDENTIAL_HELP);
  });

  it("ships what the deployment overrode, not what the provider declared", async () => {
    const service = await host({
      credentialHelp: {
        gitlab: { docsUrl: "https://wiki.example.internal/dsh" },
      },
    });
    const gitlab = service
      .providers("qa-token-user-1")
      .find((entry) => entry.id === "gitlab");
    expect(gitlab?.credentialHelp?.docs).toEqual({
      url: "https://wiki.example.internal/dsh",
      label: GITLAB_CREDENTIAL_HELP.docs?.label,
    });
  });

  it("keeps the help identical for every account and free of secrets", async () => {
    const service = await host();
    const first = service.providers("qa-token-user-1");
    const second = service.providers("qa-token-user-2");
    // Help is deployment metadata: it never varies per account, and the payload
    // has no field a credential value could travel in.
    expect(second).toEqual(first);
    expect(offendingKey(first)).toBeUndefined();
  });
});
