/**
 * Configuration resolution: the schema is fail-loud, defaults materialize, and
 * "the user named this knob" stays distinguishable from "a default filled it"
 * so the runtime can tell an explicit `recallLimit` from a fallback
 * (SPEC §13-§14, §22.2).
 *
 * `resolveConfig` is called with an explicit environment object in every test:
 * the plugin reads `~/.openviking` when an environment variable is absent, and
 * a developer's real credentials must not decide whether these assertions hold.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  Config,
  resolveConfig,
  resolveInjectionPlan,
  type CaptureMode,
  type InjectionPlan,
  type ResolvedConfig,
} from "../src/config.js";

/** One `~standard.validate` result, narrowed to what these tests assert. */
interface SchemaResult {
  readonly value?: Config;
  readonly issues?: readonly {
    readonly message: string;
    readonly path?: readonly unknown[];
  }[];
}

interface StandardSchemaLike {
  readonly "~standard": {
    readonly validate: (input: unknown) => SchemaResult | Promise<SchemaResult>;
  };
}

const schema = Config as unknown as StandardSchemaLike;

async function validate(input: unknown): Promise<SchemaResult> {
  return await schema["~standard"].validate(input);
}

function requireValue(result: SchemaResult): Config {
  if (!result.value) throw new Error("expected the schema to resolve a value");
  return result.value;
}

/** The state dir and credential paths every resolution in this file uses. */
let stateDir: string;
let envBase: NodeJS.ProcessEnv;

const WORKSPACE = "/workspace/project";

beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "ov-config-"));
  envBase = {
    // Identity/peer caches and the credential lookup both have real defaults
    // under `~/.openviking`; point them at temp paths for the whole file.
    OPENVIKING_STATE_DIR: stateDir,
    OPENVIKING_CLI_CONFIG_FILE: join(stateDir, "absent-ovcli.conf"),
    OPENVIKING_CONFIG_FILE: join(stateDir, "absent-ov.conf"),
  };
});

afterEach(async () => {
  await rm(stateDir, { recursive: true, force: true });
});

function resolveIn(
  input: Config = {},
  overrides: NodeJS.ProcessEnv = {},
): ResolvedConfig {
  return resolveConfig(input, { ...envBase, ...overrides }, WORKSPACE);
}

describe("environment overrides (SPEC §13)", () => {
  it("applies and normalizes every OPENVIKING_* override", () => {
    const env: NodeJS.ProcessEnv = {
      ...envBase,
      OPENVIKING_URL: "http://127.0.0.1:19464/",
      OPENVIKING_WORKSPACE_PEER: "0",
      OPENVIKING_RECALL_PEER_SCOPE: "actor",
      OPENVIKING_RECALL_QUERY_EXPANSION: "off",
      OPENVIKING_RECALL_LIMIT: "7",
    };

    // The env object is passed explicitly: process.env is never touched here.
    const config = resolveConfig({}, env, WORKSPACE);

    expect(config.endpoint).toBe("http://127.0.0.1:19464");
    expect(config.workspacePeer).toBe(false);
    expect(config.peerId).toBe("");
    expect(config.recallPeerScope).toBe("actor");
    expect(config.recallQueryExpansion).toBe("off");
    expect(config.recallQueryExpansionConfigured).toBe(true);
    expect(config.recallLimit).toBe(7);
    expect(config.recallLimitConfigured).toBe(true);
  });

  it("keeps workspace peers on when OPENVIKING_WORKSPACE_PEER is unset", () => {
    const config = resolveIn({});

    expect(config.workspacePeer).toBe(true);
    expect(config.recallQueryExpansionConfigured).toBe(false);
    expect(config.recallLimitConfigured).toBe(false);
  });
});

describe("config precedence", () => {
  it("lets explicit plugin config override every credential-file value", () => {
    const config = resolveIn(
      {
        endpoint: "http://plugin.local",
        apiKey: "plugin-key",
        account: "plugin-account",
        user: "plugin-user",
        peerId: "plugin-peer",
      },
      {
        OPENVIKING_URL: "http://env.local",
        OPENVIKING_API_KEY: "env-key",
        OPENVIKING_ACCOUNT: "env-account",
        OPENVIKING_USER: "env-user",
        OPENVIKING_PEER_ID: "env-peer",
      },
    );

    expect(config.endpoint).toBe("http://plugin.local");
    expect(config.apiKey).toBe("plugin-key");
    expect(config.account).toBe("plugin-account");
    expect(config.user).toBe("plugin-user");
    expect(config.peerId).toBe("plugin-peer");
  });
});

describe("credential file resolution", () => {
  async function writeCliConfig(): Promise<string> {
    const file = join(stateDir, "ovcli.conf");
    await writeFile(
      file,
      JSON.stringify({
        url: "http://cli.local/",
        api_key: "cli-key",
        account: "cli-account",
        user: "cli-user",
        actor_peer_id: "cli-peer",
      }),
      "utf-8",
    );
    return file;
  }

  it("reads the endpoint, key, account, user and peer from the CLI config file", async () => {
    const file = await writeCliConfig();

    const config = resolveIn({}, { OPENVIKING_CLI_CONFIG_FILE: file });

    expect(config.endpoint).toBe("http://cli.local");
    expect(config.apiKey).toBe("cli-key");
    expect(config.account).toBe("cli-account");
    expect(config.user).toBe("cli-user");
    expect(config.peerId).toBe("cli-peer");
  });

  it("ignores the file key in OPENVIKING_CREDENTIAL_SOURCE=env mode", async () => {
    const file = await writeCliConfig();

    const config = resolveIn(
      {},
      {
        OPENVIKING_CLI_CONFIG_FILE: file,
        OPENVIKING_CREDENTIAL_SOURCE: "env",
        OPENVIKING_URL: "http://env.local/",
        OPENVIKING_API_KEY: "env-key",
        OPENVIKING_ACCOUNT: "env-account",
        OPENVIKING_USER: "env-user",
        OPENVIKING_PEER_ID: "env-peer",
      },
    );

    expect(config.endpoint).toBe("http://env.local");
    expect(config.apiKey).toBe("env-key");
    expect(config.account).toBe("env-account");
    expect(config.user).toBe("env-user");
    expect(config.peerId).toBe("env-peer");
  });
});

describe("the config schema is fail-loud (SPEC §14)", () => {
  const REJECTED: readonly (readonly [string, Record<string, unknown>])[] = [
    ["scoreThreshold above 1", { scoreThreshold: 2 }],
    ["recallLimit above 50", { recallLimit: 500 }],
    ["recallLimit below 1", { recallLimit: 0 }],
    ["requestTimeoutMs below 1000", { requestTimeoutMs: 500 }],
    ["recallPeerScope outside its enum", { recallPeerScope: "everyone" }],
    ["captureMode outside its enum", { captureMode: "fuzzy" }],
    ["recallRewrite outside its enum", { recallRewrite: "maybe" }],
    ["captureFilters that is not an array", { captureFilters: "not-an-array" }],
  ];

  it.each(REJECTED)(
    "reports issues for %s instead of clamping",
    async (_label, input) => {
      const result = await validate(input);

      expect(result.issues).toBeDefined();
      expect(result.issues?.length ?? 0).toBeGreaterThan(0);
      expect(result.value).toBeUndefined();
    },
  );

  it("resolves a valid config without issues", async () => {
    const result = await validate({
      endpoint: "http://127.0.0.1:1933",
      autoInject: true,
      recallLimit: 7,
      captureFilters: ["s/secret/REDACTED/g"],
    });

    expect(result.issues).toBeUndefined();
    expect(requireValue(result).recallLimit).toBe(7);
  });
});

describe("materialized defaults vs. configured markers", () => {
  it("fills defaults but leaves the four opt-in knobs absent", async () => {
    const result = await validate({});
    expect(result.issues).toBeUndefined();
    const value = requireValue(result);

    expect(value.autoInject).toBe(true);
    expect(value.recallPeerScope).toBe("all");
    expect(value.captureFilters).toEqual([]);

    // `resolveConfig` distinguishes "the user asked for it" from "a default
    // filled it" with `Object.hasOwn` on the raw input, so these two must stay
    // absent after a default-valued validate().
    expect(Object.hasOwn(value, "recallLimit")).toBe(false);
    expect(Object.hasOwn(value, "recallQueryExpansion")).toBe(false);
  });

  it("cross-checks the resolved plan for a default config", async () => {
    const value = requireValue(await validate({}));
    const resolved = resolveIn({ ...value });

    // Still "not configured": the schema left the opt-in knobs absent, so the
    // resolver does not send their request fields.
    expect(resolved.recallLimitConfigured).toBe(false);
    expect(resolved.recallQueryExpansionConfigured).toBe(false);
    expect(resolveInjectionPlan(resolved)).toEqual({
      startupProfile: true,
      stepProfile: true,
      recall: true,
    });
  });
});

describe("resolveInjectionPlan is a pure conjunction with the master switch", () => {
  const MATRIX: readonly {
    readonly autoInject: boolean;
    readonly injectStartupProfile: boolean;
    readonly injectStepProfile: boolean;
    readonly autoRecall: boolean;
    readonly plan: InjectionPlan;
  }[] = [
    {
      autoInject: false,
      injectStartupProfile: false,
      injectStepProfile: false,
      autoRecall: false,
      plan: { startupProfile: false, stepProfile: false, recall: false },
    },
    {
      autoInject: false,
      injectStartupProfile: true,
      injectStepProfile: false,
      autoRecall: false,
      plan: { startupProfile: false, stepProfile: false, recall: false },
    },
    {
      autoInject: false,
      injectStartupProfile: false,
      injectStepProfile: true,
      autoRecall: false,
      plan: { startupProfile: false, stepProfile: false, recall: false },
    },
    {
      autoInject: false,
      injectStartupProfile: false,
      injectStepProfile: false,
      autoRecall: true,
      plan: { startupProfile: false, stepProfile: false, recall: false },
    },
    {
      autoInject: false,
      injectStartupProfile: true,
      injectStepProfile: true,
      autoRecall: true,
      plan: { startupProfile: false, stepProfile: false, recall: false },
    },
    {
      autoInject: true,
      injectStartupProfile: true,
      injectStepProfile: true,
      autoRecall: true,
      plan: { startupProfile: true, stepProfile: true, recall: true },
    },
    {
      autoInject: true,
      injectStartupProfile: true,
      injectStepProfile: false,
      autoRecall: false,
      plan: { startupProfile: true, stepProfile: false, recall: false },
    },
    {
      autoInject: true,
      injectStartupProfile: false,
      injectStepProfile: true,
      autoRecall: true,
      plan: { startupProfile: false, stepProfile: true, recall: true },
    },
  ];

  it.each(MATRIX)(
    "autoInject=$autoInject mirrors $injectStartupProfile/$injectStepProfile/$autoRecall",
    ({
      autoInject,
      injectStartupProfile,
      injectStepProfile,
      autoRecall,
      plan,
    }) => {
      const resolved = resolveIn({
        autoInject,
        injectStartupProfile,
        injectStepProfile,
        autoRecall,
      });

      expect(resolveInjectionPlan(resolved)).toEqual(plan);
      if (!autoInject) {
        expect(resolveInjectionPlan(resolved)).toEqual({
          startupProfile: false,
          stepProfile: false,
          recall: false,
        });
      }
    },
  );
});

describe("inert-for-compatibility knobs", () => {
  it("keeps captureMode keyword and normalizes anything else to semantic", () => {
    expect(resolveIn({ captureMode: "keyword" }).captureMode).toBe("keyword");
    expect(resolveIn({ captureMode: "semantic" }).captureMode).toBe("semantic");
    // The schema rejects an unknown mode; the resolver still normalizes one that
    // reaches it, so a config written for an older build cannot leak through.
    expect(
      resolveIn({ captureMode: "fuzzy" as unknown as CaptureMode }).captureMode,
    ).toBe("semantic");
  });

  it("survives resolution with the value the user set", () => {
    const configured = resolveIn({
      commitTokenThreshold: 5000,
      commitKeepRecentCount: 3,
      captureMaxLength: 1200,
      captureToolMaxChars: 200000,
      profileTokenBudget: 4000,
      minQueryLength: 5,
      recallPreferAbstract: false,
      recallTokenBudget: 800,
      recallMaxContentChars: 300,
      requestTimeoutMs: 2500,
      mcpToolCallTimeoutMs: 45000,
      peerSource: "cwd",
      skipSubagentSessions: true,
    });

    expect(configured.commitTokenThreshold).toBe(5000);
    expect(configured.commitKeepRecentCount).toBe(3);
    expect(configured.captureMaxLength).toBe(1200);
    expect(configured.captureToolMaxChars).toBe(200000);
    expect(configured.profileTokenBudget).toBe(4000);
    expect(configured.minQueryLength).toBe(5);
    expect(configured.recallPreferAbstract).toBe(false);
    expect(configured.recallTokenBudget).toBe(800);
    expect(configured.recallMaxContentChars).toBe(300);
    expect(configured.requestTimeoutMs).toBe(2500);
    expect(configured.mcpToolCallTimeoutMs).toBe(45000);
    expect(configured.peerSource).toBe("cwd");
    expect(configured.skipSubagentSessions).toBe(true);
  });
});
