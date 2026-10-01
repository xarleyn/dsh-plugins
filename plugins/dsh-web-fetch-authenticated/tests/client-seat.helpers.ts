/**
 * Shared harness for the two files that watch this bundle's seat on the Host
 * Plugins page: `client-registration.test.ts` (what `apply()` hands the slot) and
 * `client-card.test.tsx` (what the browser draws from it).
 *
 * Both need the same stand for the browser runtime — a bare Cordis context, a
 * mounted Remote namespace, the Host `ConfigForm`, and a slot registry that keeps
 * the registration instead of rendering it. One copy is the point: a stub shaped
 * for only one of the two lets the pair drift apart, and this seat fails by
 * disappearing rather than by throwing.
 */

import { Context } from "@deepseek-ai/cordis";
import type { ReactElement } from "react";
import { apply } from "../src/client/index.js";
import type {
  AuthenticatedFetchRule,
  DiagnoseReport,
  ProviderStatusReport,
  RuleTestReport,
  WebFetchAuthConfig,
} from "../src/types.js";

/** One write the card sent to the stand form, in the order it sent it. */
export interface FormWrite {
  readonly field: string;
  readonly value: unknown;
}

/**
 * What the entrypoint handed `ctx.slots.register`, with the writes the rendered
 * card makes against the stand form riding along.
 */
export interface Seat {
  readonly name: string;
  readonly key: string | undefined;
  readonly face: Record<string, unknown>;
  readonly component: (props: Record<string, unknown>) => ReactElement;
  readonly writes: readonly FormWrite[];
}

/** One synthetic rule, so the opened card has a row of its own to draw. */
const DEMO_RULE: AuthenticatedFetchRule = {
  id: "rule-demo",
  name: "Demo product",
  enabled: true,
  match: { hosts: ["demo.example.corp"] },
  auth: { type: "bearer", credential: "DEMO_TOKEN" },
};

/** The configuration the stand form answers with. */
export function demoConfig(): WebFetchAuthConfig {
  return { enabled: true, rules: [DEMO_RULE] };
}

/** The provider projection the card's status section shows. */
export function demoStatus(): ProviderStatusReport {
  return {
    enabled: true,
    registered: true,
    available: true,
    ruleCount: 1,
    enabledRuleCount: 1,
    credentialStates: [],
    configErrors: [],
    lastTests: [],
    unmatchedPolicy: "block",
  };
}

const DEMO_TEST: RuleTestReport = {
  ok: true,
  ruleId: DEMO_RULE.id,
  ruleName: DEMO_RULE.name,
  url: "https://demo.example.corp/",
  startedAt: 0,
  durationMs: 1,
  matchedRule: true,
  networkAllowed: true,
  addresses: [],
  redirectCount: 0,
  authApplied: true,
  outcome: "ok",
  truncated: false,
};

const DEMO_DIAGNOSIS: DiagnoseReport = {
  url: "https://demo.example.corp/",
  validUrl: true,
  match: { ruleId: DEMO_RULE.id, ruleName: DEMO_RULE.name, reason: "host" },
  networkAllowed: true,
  addresses: [],
  redirectPolicy: "same-origin",
};

/**
 * The Remote answers. Nothing in these two files clicks the tester or the
 * diagnostic runner, so the payloads only have to be well-typed — the calls the
 * card does make on mount are `status()`, and that one returns the real report.
 */
const remoteStub = {
  status: () => Promise.resolve({ ok: true as const, value: demoStatus() }),
  testRule: () => Promise.resolve({ ok: true as const, value: DEMO_TEST }),
  diagnose: () => Promise.resolve({ ok: true as const, value: DEMO_DIAGNOSIS }),
};

/** Credential facts only — a value never rides this face (SPEC §21). */
const credentialsStub = {
  describe: () => Promise.resolve({ ok: true as const, value: {} }),
  set: () => Promise.resolve({ ok: true as const, value: undefined }),
  unset: () => Promise.resolve({ ok: true as const, value: undefined }),
};

/**
 * The Host `ConfigForm` for the namespace. `client-registration.test.ts` asserts
 * its identity across the slot boundary; `client-card.test.tsx` has the card read
 * its snapshot through the store binding and writes through `set`, so the value
 * here is the configuration under test, `writes` is the record of what the card
 * asked the Host to store, and `settingsStatus` stands for the Host being
 * unreachable.
 */
function formStub(
  config: WebFetchAuthConfig,
  settingsStatus: "ready" | "unavailable",
  writes: FormWrite[],
) {
  const snapshot = {
    status: settingsStatus,
    value: settingsStatus === "ready" ? config : undefined,
    base: undefined,
    user: config,
    revision: 1,
    writable: settingsStatus === "ready",
    mode: "host" as const,
  };
  return {
    get: () => config,
    getSnapshot: () => snapshot,
    set: (field: string, value: unknown) => {
      writes.push({ field, value });
      return Promise.resolve(true);
    },
    unset: () => Promise.resolve(true),
    mutate: () => Promise.resolve(true),
    subscribe: () => () => undefined,
  };
}

/**
 * Drive `apply()` against a bare context and keep the seat it registered.
 *
 * The mounted Remote namespace is exposed twice: as a property of the `remote`
 * face, which the code under test reads, and as a service key of its own, which
 * `ctx.inject(["remote.webFetchAuth"])` resolves. A bare context stands in for the
 * browser runner, whose gateway isolate map answers that key.
 */
export async function registeredSeat(
  config: WebFetchAuthConfig = demoConfig(),
  settingsStatus: "ready" | "unavailable" = "ready",
): Promise<Seat> {
  const seats: Omit<Seat, "writes">[] = [];
  const writes: FormWrite[] = [];
  const form = formStub(config, settingsStatus, writes);
  const ctx = new Context();
  ctx.provide("remote", {
    webFetchAuth: remoteStub,
    credentials: credentialsStub,
    $mount: () => Promise.resolve(() => Promise.resolve()),
  });
  ctx.provide("remote.webFetchAuth", remoteStub);
  ctx.provide("configForms", { get: () => form });
  ctx.provide("slots", {
    inject: (_key: string, callback: () => (() => void) | void) => {
      const dispose = callback();
      return () => {
        if (typeof dispose === "function") dispose();
      };
    },
    register: (
      options: {
        name: string;
        key?: string;
        inject?: () => Record<string, unknown>;
      },
      component: unknown,
    ) => {
      seats.push({
        name: options.name,
        key: options.key,
        face: options.inject?.() ?? {},
        component: component as (
          props: Record<string, unknown>,
        ) => ReactElement,
      });
      return () => undefined;
    },
  });

  await apply(ctx);
  const [seat] = seats;
  if (seat === undefined) throw new Error("apply() registered no seat");
  return { ...seat, writes };
}

/** The props the page renders the seat with: its view plus the injected face. */
export function seatProps(
  seat: Seat,
  view: "page" | "summary",
): Record<string, unknown> {
  return { ...seat.face, view };
}
