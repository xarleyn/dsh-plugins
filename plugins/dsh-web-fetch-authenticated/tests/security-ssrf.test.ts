/**
 * Security suite (SPEC §26.2): SSRF targets, lookalike hosts, mixed DNS,
 * redirect credential boundaries, and redaction guarantees. The provider must
 * fail closed in every case; secrets must never appear in thrown errors.
 */

import { describe, expect, test } from "vitest";
import { resolveConfig } from "../src/config.js";
import {
  AddressPolicyDeniedError,
  resolveApprovedAddresses,
} from "../src/policy/dns.js";
import {
  classifyIp,
  evaluateAddress,
  evaluateAddresses,
} from "../src/policy/network.js";
import { validateFetchUrl } from "../src/policy/url.js";
import { InvalidUrlError } from "../src/policy/url.js";
import { matchRules } from "../src/policy/match.js";
import { configWith, fixtureRule } from "./helpers.js";
import { expectWebError, newProvider } from "./security.helpers.js";

describe("lookalike and userinfo URLs", () => {
  test("jira.example.corp.attacker.com does not match the rule", () => {
    const rule = resolveConfig(
      configWith([
        fixtureRule("http://x", {
          id: "corp",
          match: {
            schemes: ["https"],
            hosts: ["jira.example.corp"],
            allowPaths: ["/browse/**"],
          },
        }),
      ]),
    ).rules[0]!;
    const url = validateFetchUrl(
      "https://jira.example.corp.attacker.com/browse/PROJ-1",
      2048,
    );
    expect(matchRules([rule], url)).toHaveLength(0);
  });

  test("jira.example.corp:secret@attacker.com is rejected at URL validation", () => {
    expect(() =>
      validateFetchUrl("https://user:secret@attacker.example/", 2048),
    ).toThrow(InvalidUrlError);
  });

  test("non-http(s) schemes are rejected", () => {
    expect(() => validateFetchUrl("file:///etc/passwd", 2048)).toThrow(
      InvalidUrlError,
    );
    expect(() => validateFetchUrl("ftp://example.invalid/", 2048)).toThrow(
      InvalidUrlError,
    );
  });
});

describe("SSRF address policy", () => {
  const defaultPolicy = {
    allowPublic: true,
    allowPrivate: false,
    allowLoopback: false,
    allowLinkLocal: false,
    allowCGNAT: false,
    allowIPv6ULA: false,
    allowedCidrs: [],
    deniedCidrs: [],
  };

  test("loopback", () => {
    expect(classifyIp("127.0.0.1")).toBe("loopback");
    expect(classifyIp("::1")).toBe("loopback");
    expect(evaluateAddress("127.0.0.1", defaultPolicy).allowed).toBe(false);
  });

  test("metadata endpoints are always denied, even with allowLinkLocal", () => {
    expect(classifyIp("169.254.169.254")).toBe("metadata");
    expect(classifyIp("fd00:ec2::254")).toBe("metadata");
    const permissive = {
      ...defaultPolicy,
      allowLinkLocal: true,
      allowedCidrs: ["169.254.0.0/16"],
    };
    expect(evaluateAddress("169.254.169.254", permissive).allowed).toBe(false);
  });

  test("private, CGNAT, ULA, multicast, unspecified classes", () => {
    expect(classifyIp("10.0.0.1")).toBe("private");
    expect(classifyIp("172.16.5.5")).toBe("private");
    expect(classifyIp("192.168.1.1")).toBe("private");
    expect(classifyIp("100.64.0.10")).toBe("cgnat");
    expect(classifyIp("fd12:3456::1")).toBe("ipv6ULA");
    expect(classifyIp("224.0.0.1")).toBe("multicast");
    expect(classifyIp("0.0.0.0")).toBe("unspecified");
    expect(classifyIp("8.8.8.8")).toBe("public");
    expect(classifyIp("2001:4860:4860::8888")).toBe("public");
  });

  test("mixed public/private DNS answers fail closed", async () => {
    await expect(
      resolveApprovedAddresses("rebind.example", defaultPolicy, async () => [
        "8.8.8.8",
        "10.0.0.1",
      ]),
    ).rejects.toBeInstanceOf(AddressPolicyDeniedError);
  });

  test("single denied answer denies the set", async () => {
    await expect(
      resolveApprovedAddresses("intranet.example", defaultPolicy, async () => [
        "192.168.0.10",
      ]),
    ).rejects.toBeInstanceOf(AddressPolicyDeniedError);
  });

  test("allowedCidrs override class denial; deniedCidrs win over allowedCidrs", async () => {
    const policy = { ...defaultPolicy, allowedCidrs: ["10.20.0.0/16"] };
    const approved = await resolveApprovedAddresses(
      "jira.internal",
      policy,
      async () => ["10.20.14.18"],
    );
    expect(approved.approved).toHaveLength(1);
    const stricter = { ...policy, deniedCidrs: ["10.20.100.0/24"] };
    await expect(
      resolveApprovedAddresses("jira.internal", stricter, async () => [
        "10.20.100.7",
      ]),
    ).rejects.toBeInstanceOf(AddressPolicyDeniedError);
  });

  test("provider rejects loopback, metadata, and IPv6 loopback without explicit permission", async () => {
    const rule = fixtureRule("http://127.0.0.1:1", {
      id: "ssrf",
      match: {
        schemes: ["http"],
        hosts: ["169.254.169.254", "127.0.0.1", "[::1]"],
      },
      networkPolicy: { allowLoopback: false },
    });
    const { provider } = newProvider(configWith([rule]));
    await expectWebError("AUTH_FETCH_NETWORK_DENIED", () =>
      provider.fetch({ url: "http://127.0.0.1:1/" }),
    );
    await expectWebError("AUTH_FETCH_NETWORK_DENIED", () =>
      provider.fetch({ url: "http://169.254.169.254/latest/meta-data/" }),
    );
    await expectWebError("AUTH_FETCH_NETWORK_DENIED", () =>
      provider.fetch({ url: "http://[::1]:1/" }),
    );
  });
});

describe("evaluateAddresses verdicts", () => {
  test("reports per-address verdicts with classes", () => {
    const policy = {
      allowPublic: true,
      allowPrivate: false,
      allowLoopback: false,
      allowLinkLocal: false,
      allowCGNAT: false,
      allowIPv6ULA: false,
      allowedCidrs: [],
      deniedCidrs: [],
    };
    const verdicts = evaluateAddresses(["8.8.8.8", "10.1.2.3"], policy);
    expect(verdicts.allowed).toBe(false);
    expect(verdicts.firstDenied?.networkClass).toBe("private");
  });
});
