import { vi } from "vitest";
import { QaAccountsController } from "../../src/client/QaAccountsController.js";
import { resolveConfig } from "../../src/resolve-config.js";
import type { QaAccountsApi } from "../../src/client/types.js";
import type {
  QaAccountSession,
  QaServiceTokenSummary,
  QaWhoamiResult,
} from "../../src/types.js";
function storage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: () => null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  } as Storage;
}

function session(token: string): {
  readonly ok: true;
  readonly value: QaAccountSession;
} {
  return {
    ok: true,
    value: {
      token,
      user: {
        id: "u-1",
        email: "a@b.co",
        displayName: "a",
        role: "admin",
        createdAt: "2026-09-11T00:00:00.000Z",
        lastLoginAt: null,
        disabled: false,
        profile: {
          fullName: "",
          identities: {},
          instructions: "",
          updatedAt: null,
        },
        starters: { items: [], hideDefaults: false },
      },
    },
  };
}

function remote(
  overrides: Partial<Record<keyof QaAccountsApi, unknown>> = {},
): QaAccountsApi {
  return {
    accountsWhoami: vi.fn(async () => ({
      ok: true as const,
      value: { authenticated: false } as QaWhoamiResult,
    })),
    accountsLogin: vi.fn(async () => session("t-login")),
    accountsRegister: vi.fn(async () => session("t-register")),
    accountsClaimSessions: vi.fn(async () => ({
      ok: true as const,
      value: { claimed: 0, conflicts: [] },
    })),
    accountsOwnedSessions: vi.fn(async () => ({
      ok: true as const,
      value: { ids: ["s-1"] },
    })),
    accountsListOwnership: vi.fn(async () => ({
      ok: true as const,
      value: { entries: [] },
    })),
    accountsUpdateProfile: vi.fn(async (_token, input) => ({
      ok: true as const,
      value: {
        ...session("t-login").value.user,
        profile: { ...input, updatedAt: "2026-09-13T00:00:00.000Z" },
      },
    })),
    accountsUpdateStarters: vi.fn(async (_token, input) => ({
      ok: true as const,
      value: { ...session("t-login").value.user, starters: input },
    })),
    accountsChangePassword: vi.fn(async () => session("t-changed")),
    accountsRequestPasswordReset: vi.fn(async () => ({
      ok: true as const,
      value: { accepted: true as const },
    })),
    accountsListServiceTokens: vi.fn(async () => ({
      ok: true as const,
      value: { tokens: [] },
    })),
    accountsCreateServiceToken: vi.fn(async (_token, input) => ({
      ok: true as const,
      value: {
        id: "token-1",
        token: "qsat.token-1.secret",
        label: input.label ?? "integration",
        scopes: (input.scopes ?? ["ask"]) as QaServiceTokenSummary["scopes"],
        createdAt: "2026-09-21T10:00:00.000Z",
        expiresAt: "2026-12-20T10:00:00.000Z",
        lastUsedAt: null,
        revokedAt: null,
        useCount: 0,
      },
    })),
    accountsRevokeServiceToken: vi.fn(async () => ({
      ok: true as const,
      value: { revoked: true },
    })),
    ...overrides,
  } as QaAccountsApi;
}

function controller(
  api: QaAccountsApi,
  options: {
    legacyChatIds?: () => readonly string[];
    forgetChat?: (id: string) => void;
    showOtherUsersChats?: boolean;
  } = {},
): QaAccountsController {
  const { showOtherUsersChats = false, ...controllerOptions } = options;
  return new QaAccountsController({
    remote: api,
    storage: storage(),
    config: () => resolveConfig({ accounts: { showOtherUsersChats } }),
    ...controllerOptions,
  });
}

const TOKEN_KEY = "dsh-qa-surface.session:v1:/qa:account-token";

export { TOKEN_KEY, controller, remote, session, storage };
