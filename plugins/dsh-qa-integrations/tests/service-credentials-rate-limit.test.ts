import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { IntegrationError } from "../src/errors.js";
import {
  ServiceRateLimitError,
  ServiceRateLimiter,
} from "../src/service-credentials/rate-limit.js";
import {
  resolveManagedServiceCredentials,
  type ManagedServiceCredentialsInput,
} from "../src/service-credentials/config.js";
import {
  ACME_PROFILE,
  buildHarness,
  repositories,
} from "./service-credentials.helpers.js";

const CALL = (project = "alpha") => ({
  provider: "acme",
  operation: "records.get",
  input: { project },
  sourceSessionId: "s1",
});

/**
 * The fake provider refuses `forbidden` upstream, so a profile has to list it in
 * its boundary for the call to get that far.
 */
const PROFILE_REFUSING = {
  ...ACME_PROFILE,
  resources: { projects: ["alpha", "forbidden"] },
};

function managedInput(
  rateLimit: unknown,
  profile: unknown = ACME_PROFILE,
): ManagedServiceCredentialsInput {
  return {
    enabled: true,
    defaultForNewConnections: true,
    rateLimit,
    profiles: [profile],
  } as unknown as ManagedServiceCredentialsInput;
}

/** A clock the suite advances by hand, so a minute is a number, not a wait. */
function controllableClock(): {
  now: () => number;
  advance: (ms: number) => void;
} {
  let at = 1_700_000_000_000;
  return {
    now: () => at,
    advance: (ms: number) => {
      at += ms;
    },
  };
}

const configOf = (rateLimit: unknown) =>
  resolveManagedServiceCredentials(managedInput(rateLimit)).rateLimit;

/** What one synchronous call threw, so the refusal itself can be inspected. */
function rejection(body: () => unknown): unknown {
  try {
    body();
  } catch (error) {
    return error;
  }
  return undefined;
}

const ALICE = { principal: "alice", provider: "acme", profileId: "p" };
const BOB = { principal: "bob", provider: "acme", profileId: "p" };

describe("service mode rate limiting", () => {
  const root = mkdtempSync(path.join(tmpdir(), "qa-integrations-rate-"));
  afterAll(() => {
    for (const repository of repositories) repository.close();
    rmSync(root, { recursive: true, force: true });
  });

  describe("the limiter", () => {
    it("limits a principal without limiting anybody else", () => {
      const clock = controllableClock();
      const limiter = new ServiceRateLimiter(
        configOf({
          perPrincipal: { requestsPerMinute: 2 },
          perCredential: { requestsPerMinute: 100 },
        }),
        clock.now,
      );
      for (let index = 0; index < 2; index += 1) {
        expect(() => limiter.acquire(ALICE)).not.toThrow();
      }
      expect(() => limiter.acquire(ALICE)).toThrow(IntegrationError);
      // Bob is bounded by his own request count, not by Alice's.
      expect(() => limiter.acquire(BOB)).not.toThrow();
    });

    it("keeps one principal's allowance separate per provider", () => {
      const limiter = new ServiceRateLimiter(
        configOf({ perPrincipal: { requestsPerMinute: 1 } }),
      );
      expect(() => limiter.acquire(ALICE)).not.toThrow();
      const refusal = rejection(() => limiter.acquire(ALICE));
      expect(refusal).toBeInstanceOf(IntegrationError);
      expect((refusal as ServiceRateLimitError).code).toBe("RateLimited");
      expect((refusal as ServiceRateLimitError).reason).toBe("principal");
      expect(() =>
        limiter.acquire({ ...ALICE, provider: "other" }),
      ).not.toThrow();
    });

    it("refills continuously rather than on a wall-clock minute", () => {
      const clock = controllableClock();
      const limiter = new ServiceRateLimiter(
        configOf({ perPrincipal: { requestsPerMinute: 6 } }),
        clock.now,
      );
      for (let index = 0; index < 6; index += 1) {
        limiter.acquire(ALICE);
      }
      // Ten seconds of a six-per-minute allowance is exactly one request.
      clock.advance(10_000);
      expect(() => limiter.acquire(ALICE)).not.toThrow();
      expect(() => limiter.acquire(ALICE)).toThrow(IntegrationError);
    });

    it("never spends the allowance a refusal was about", () => {
      const clock = controllableClock();
      const limiter = new ServiceRateLimiter(
        configOf({
          perPrincipal: { requestsPerMinute: 3 },
          perCredential: { requestsPerMinute: 2 },
        }),
        clock.now,
      );
      limiter.acquire(ALICE);
      limiter.acquire(ALICE);
      // The shared credential is empty, so a third request is refused by the
      // shared ceiling. Alice's own balance has to stay where it is: charging
      // it would make her pay twice for a bottleneck the deployment shares.
      const refusal = rejection(() => limiter.acquire(ALICE));
      expect(refusal).toBeInstanceOf(IntegrationError);
      expect((refusal as ServiceRateLimitError | undefined)?.reason).toBe(
        "credential",
      );
      clock.advance(30_000);
      expect(() => limiter.acquire(ALICE)).not.toThrow();
      // Two requests above plus this one are the whole three-per-minute
      // allowance; had the refusal cost her anything, this would throw.
      expect(() => limiter.acquire(ALICE)).toThrow(IntegrationError);
    });

    it("caps how many calls one credential carries at once", () => {
      const limiter = new ServiceRateLimiter(
        configOf({ perCredential: { maxConcurrent: 2 } }),
      );
      const first = limiter.acquire(ALICE);
      limiter.acquire(BOB);
      expect(() => limiter.acquire({ ...ALICE, principal: "carol" })).toThrow(
        IntegrationError,
      );
      first();
      expect(() =>
        limiter.acquire({ ...ALICE, principal: "carol" }),
      ).not.toThrow();
    });

    it("gives a concurrency slot back only once", () => {
      const limiter = new ServiceRateLimiter(
        configOf({ perCredential: { maxConcurrent: 1 } }),
      );
      const release = limiter.acquire(ALICE);
      release();
      release();
      // A double release must not have made room for a second caller.
      limiter.acquire(ALICE);
      expect(() => limiter.acquire(ALICE)).toThrow(IntegrationError);
    });

    it("leaves a dimension unbounded when the operator sets it to zero", () => {
      const limiter = new ServiceRateLimiter(
        configOf({
          perPrincipal: { requestsPerMinute: 0 },
          perCredential: { requestsPerMinute: 0, maxConcurrent: 0 },
        }),
      );
      for (let index = 0; index < 500; index += 1) {
        // Not released on purpose: a zero ceiling has to ignore concurrency too.
        limiter.acquire({ ...ALICE, principal: `user-${index}` });
      }
      expect(() => limiter.acquire(ALICE)).not.toThrow();
    });

    it("prunes only the balances that have earned their allowance back", () => {
      const clock = controllableClock();
      const limiter = new ServiceRateLimiter(
        configOf({
          perPrincipal: { requestsPerMinute: 1 },
          // The shared side stays out of the way: this is about how many
          // principals the map holds, not about the shared quota.
          perCredential: { requestsPerMinute: 1_000_000, maxConcurrent: 0 },
        }),
        clock.now,
        { maxTrackedKeys: 4 },
      );
      const key = (name: string) => ({
        principal: name,
        provider: "acme",
        profileId: "p",
      });
      // Five principals spend the one request each is allowed, so the map has to
      // make room twice over.
      for (let index = 0; index < 5; index += 1) {
        limiter.acquire(key(`user-${index}`));
      }
      // Forgetting a spent balance to make room would be a way around the limit
      // rather than a way to bound memory. Only the oldest could be shed, and
      // only once: the rest are still refused by their own exhausted allowance.
      expect(() => limiter.acquire(key("user-1"))).toThrow(IntegrationError);
      expect(() => limiter.acquire(key("user-4"))).toThrow(IntegrationError);
      // A minute later every balance is full again, pruned or not.
      clock.advance(60_000);
      expect(() => limiter.acquire(key("user-1"))).not.toThrow();
    });

    it("keeps the balance of a re-tuned limit instead of refilling it", () => {
      const limiter = new ServiceRateLimiter(
        configOf({ perPrincipal: { requestsPerMinute: 10 } }),
      );
      for (let index = 0; index < 9; index += 1) {
        limiter.acquire(ALICE)();
      }
      limiter.configure(configOf({ perPrincipal: { requestsPerMinute: 20 } }));
      expect(() => limiter.acquire(ALICE)).not.toThrow();
      expect(() => limiter.acquire(ALICE)).toThrow(IntegrationError);
    });
  });

  describe("through the broker", () => {
    it("stops one principal at the per-user ceiling and lets another through", async () => {
      const { broker, seen } = buildHarness(
        path.join(root, "principal.db"),
        managedInput({ perPrincipal: { requestsPerMinute: 2 } }),
      );
      const alice = { userId: "alice" };
      const bob = { userId: "bob" };
      await broker.connect(alice, "acme", { token: "" });
      await broker.connect(bob, "acme", { token: "" });

      for (let index = 0; index < 2; index += 1) {
        await expect(broker.call(alice, CALL())).resolves.toMatchObject({
          data: { named: "alpha" },
        });
      }
      await expect(broker.call(alice, CALL())).rejects.toMatchObject({
        code: "RateLimited",
      });
      expect(seen).toHaveLength(2);
      await expect(broker.call(bob, CALL())).resolves.toMatchObject({
        data: { named: "alpha" },
      });
    });

    it("audits a refused call as a denial and never reaches upstream", async () => {
      const { broker, seen } = buildHarness(
        path.join(root, "audit.db"),
        managedInput({ perPrincipal: { requestsPerMinute: 1 } }),
      );
      const alice = { userId: "alice" };
      await broker.connect(alice, "acme", { token: "" });
      await broker.call(alice, CALL());
      await expect(broker.call(alice, CALL())).rejects.toMatchObject({
        code: "RateLimited",
      });
      expect(repositories.at(-1)?.read().audit.at(-1)).toMatchObject({
        ownerUserId: "alice",
        operation: "records.get",
        result: "denied",
        credentialSource: "service",
        serviceProfileId: "acme-readonly",
      });
      expect(seen).toHaveLength(1);
    });

    it("refuses past the shared ceiling of the managed credential", async () => {
      const { broker, seen } = buildHarness(
        path.join(root, "shared.db"),
        managedInput({
          perPrincipal: { requestsPerMinute: 100 },
          perCredential: { requestsPerMinute: 3 },
        }),
      );
      const alice = { userId: "alice" };
      const bob = { userId: "bob" };
      await broker.connect(alice, "acme", { token: "" });
      await broker.connect(bob, "acme", { token: "" });
      await broker.call(alice, CALL());
      await broker.call(bob, CALL());
      await broker.call(alice, CALL());
      // Alice spent two of the three shared requests; the last one is Bob's to
      // lose: the shared token is a deployment ceiling, not a per-user budget.
      await expect(broker.call(bob, CALL())).rejects.toMatchObject({
        code: "RateLimited",
      });
      expect(seen).toHaveLength(3);
    });

    it("gives the concurrency slot back when a call fails", async () => {
      const { broker } = buildHarness(
        path.join(root, "slot.db"),
        managedInput({ perCredential: { maxConcurrent: 1 } }, PROFILE_REFUSING),
      );
      const alice = { userId: "alice" };
      await broker.connect(alice, "acme", { token: "" });
      await expect(broker.call(alice, CALL("forbidden"))).rejects.toMatchObject(
        { code: "ProviderPermissionDenied" },
      );
      await expect(broker.call(alice, CALL("alpha"))).resolves.toMatchObject({
        data: { named: "alpha" },
      });
    });

    it("lets a limited principal back in as the allowance refills", async () => {
      const clock = controllableClock();
      const { broker, seen } = buildHarness(
        path.join(root, "refill.db"),
        managedInput({ perPrincipal: { requestsPerMinute: 6 } }),
        { now: clock.now },
      );
      const alice = { userId: "alice" };
      await broker.connect(alice, "acme", { token: "" });
      for (let index = 0; index < 6; index += 1) {
        await expect(broker.call(alice, CALL())).resolves.toMatchObject({
          data: { named: "alpha" },
        });
      }
      await expect(broker.call(alice, CALL())).rejects.toMatchObject({
        code: "RateLimited",
      });
      expect(seen).toHaveLength(6);
      // Ten seconds of a six-per-minute allowance is one request, and the
      // refusal above did not have to wait for a whole minute to pass.
      clock.advance(10_000);
      await expect(broker.call(alice, CALL())).resolves.toMatchObject({
        data: { named: "alpha" },
      });
      expect(seen).toHaveLength(7);
    });

    it("does not limit a personal credential", async () => {
      const file = path.join(root, "personal.db");
      const before = buildHarness(file, { enabled: true, profiles: [] });
      const alice = { userId: "alice" };
      await before.broker.connect(alice, "acme", {
        token: "https://acme.example/rest/1/token-alice",
      });
      const { broker } = buildHarness(
        file,
        managedInput({ perPrincipal: { requestsPerMinute: 1 } }),
      );
      expect(broker.summary(alice, "acme").credentialSource).toBe("personal");
      for (let index = 0; index < 5; index += 1) {
        await expect(broker.call(alice, CALL("gamma"))).resolves.toMatchObject({
          data: { named: "gamma" },
        });
      }
    });
  });

  describe("configuration", () => {
    it("ships the design example as the default ceiling", () => {
      expect(
        resolveManagedServiceCredentials({ enabled: true, profiles: [] })
          .rateLimit,
      ).toEqual({
        perPrincipal: { requestsPerMinute: 120 },
        perCredential: { requestsPerMinute: 1000, maxConcurrent: 16 },
      });
    });

    it("fills a partial ceiling from the defaults", () => {
      expect(configOf({ perPrincipal: { requestsPerMinute: 5 } })).toEqual({
        perPrincipal: { requestsPerMinute: 5 },
        perCredential: { requestsPerMinute: 1000, maxConcurrent: 16 },
      });
    });

    it("accepts the documented shape", () => {
      expect(
        configOf({
          perPrincipal: { requestsPerMinute: 60 },
          perCredential: { requestsPerMinute: 500, maxConcurrent: 4 },
        }),
      ).toEqual({
        perPrincipal: { requestsPerMinute: 60 },
        perCredential: { requestsPerMinute: 500, maxConcurrent: 4 },
      });
    });

    it.each([
      ["a negative allowance", { perPrincipal: { requestsPerMinute: -1 } }],
      ["a fractional allowance", { perCredential: { requestsPerMinute: 1.5 } }],
      [
        "an allowance above the ceiling",
        { perPrincipal: { requestsPerMinute: 1_000_001 } },
      ],
      ["a non-number", { perPrincipal: { requestsPerMinute: "120" } }],
      [
        "a concurrency above the ceiling",
        { perCredential: { maxConcurrent: 1_000_000 } },
      ],
      ["a stray value", { perPrincipal: 120 }],
      ["a list where a mapping belongs", { perPrincipal: [] }],
      ["a list of ceilings", { perCredential: [1000, 16] }],
      ["a list", []],
      ["a number", 120],
    ])("rejects %s", (_name, rateLimit) => {
      expect(() =>
        resolveManagedServiceCredentials(managedInput(rateLimit)),
      ).toThrow(/rateLimit/u);
    });

    it("names the key it rejected", () => {
      expect(() =>
        resolveManagedServiceCredentials(
          managedInput({ perCredential: { maxConcurrent: -3 } }),
        ),
      ).toThrow(/rateLimit\.perCredential\.maxConcurrent/u);
    });
  });
});
