/**
 * Security suite (SPEC §26.2): SSRF targets, lookalike hosts, mixed DNS,
 * redirect credential boundaries, and redaction guarantees. The provider must
 * fail closed in every case; secrets must never appear in thrown errors.
 */

import { describe, expect, test } from "vitest";
import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import { resolveConfig } from "../src/config.js";
import {
  AddressPolicyDeniedError,
  pinnedLookup,
  resolveApprovedAddresses,
} from "../src/policy/dns.js";
import {
  classifyIp,
  evaluateAddress,
  evaluateAddresses,
  parseIp,
} from "../src/policy/network.js";
import { validateFetchUrl } from "../src/policy/url.js";
import { InvalidUrlError } from "../src/policy/url.js";
import { matchRules } from "../src/policy/match.js";
import type { NetworkClass } from "../src/types.js";
import { configWith, fixtureRule, startFixture } from "./helpers.js";
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

/** No allow-flag opens these classes (SPEC §10.3). */
const ALWAYS_DENIED_CLASSES: readonly NetworkClass[] = [
  "metadata",
  "multicast",
  "unspecified",
  "reserved",
  "broadcast",
];

describe("IPv4 written inside IPv6", () => {
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
  /** What the worst-case rule looks like: every class flag raised. */
  const permissivePolicy = {
    ...defaultPolicy,
    allowPrivate: true,
    allowLoopback: true,
    allowLinkLocal: true,
    allowCGNAT: true,
    allowIPv6ULA: true,
  };

  /** `[the IPv4 address, its class, every IPv6 spelling of the same bytes]` */
  const equivalents: ReadonlyArray<
    readonly [string, NetworkClass, readonly string[]]
  > = [
    [
      "127.0.0.1",
      "loopback",
      ["::ffff:7f00:1", "::ffff:127.0.0.1", "0:0:0:0:0:ffff:7f00:1"],
    ],
    [
      "10.0.0.1",
      "private",
      ["::ffff:0a00:0001", "::ffff:10.0.0.1", "0:0:0:0:0:ffff:0a00:0001"],
    ],
    ["192.168.1.1", "private", ["::ffff:c0a8:0101", "::ffff:192.168.1.1"]],
    ["172.16.5.5", "private", ["::ffff:ac10:0505", "::ffff:172.16.5.5"]],
    [
      "169.254.9.254",
      "linkLocal",
      ["::ffff:a9fe:09fe", "::ffff:169.254.9.254"],
    ],
    ["100.64.0.1", "cgnat", ["::ffff:6440:0001", "::ffff:100.64.0.1"]],
    ["0.0.0.1", "unspecified", ["::ffff:0000:0001", "::ffff:0.0.0.1"]],
    ["224.0.0.1", "multicast", ["::ffff:e000:0001", "::ffff:224.0.0.1"]],
    [
      "255.255.255.255",
      "broadcast",
      ["::ffff:ffff:ffff", "::ffff:255.255.255.255"],
    ],
    // 169.254.169.254 is the cloud metadata endpoint: `ALWAYS_DENIED` has no
    // override, so spelling it in IPv6 must not reach it either (SPEC §10.3).
    [
      "169.254.169.254",
      "metadata",
      [
        "::ffff:a9fe:a9fe",
        "::ffff:169.254.169.254",
        "0:0:0:0:0:ffff:a9fe:a9fe",
      ],
    ],
    ["8.8.8.8", "public", ["::ffff:0808:0808", "::ffff:8.8.8.8"]],
  ];

  test("each equivalent form gets its IPv4 class and the IPv4 verdict", () => {
    for (const [ipv4, networkClass, forms] of equivalents) {
      expect(classifyIp(ipv4)).toBe(networkClass);
      for (const form of forms) {
        expect(classifyIp(form), form).toBe(networkClass);
        const denied = ALWAYS_DENIED_CLASSES.includes(networkClass);
        expect(evaluateAddress(form, defaultPolicy).allowed, form).toBe(
          networkClass === "public",
        );
        expect(evaluateAddress(form, permissivePolicy).allowed, form).toBe(
          !denied,
        );
      }
    }
  });

  test("a denied IPv4 range also denies its IPv6 spelling, and so does an allowed one", () => {
    const mapped = "::ffff:0a00:0001";
    expect(
      evaluateAddress(mapped, {
        ...permissivePolicy,
        allowPrivate: false,
      }).allowed,
    ).toBe(false);
    expect(
      evaluateAddress(mapped, {
        ...defaultPolicy,
        allowedCidrs: ["10.0.0.0/8"],
      }).allowed,
    ).toBe(true);
    expect(
      evaluateAddress(mapped, {
        ...permissivePolicy,
        deniedCidrs: ["10.0.0.0/8"],
      }).allowed,
    ).toBe(false);
    // A rule that already denied the mapped space in IPv6 terms keeps working:
    // the address is judged in both of its byte forms.
    expect(
      evaluateAddress(mapped, {
        ...permissivePolicy,
        deniedCidrs: ["::ffff:0:0/96"],
      }).allowed,
    ).toBe(false);
  });

  test("the deprecated IPv4-compatible and NAT64 forms never open as public", () => {
    for (const text of [
      "::7f00:0001",
      "::127.0.0.1",
      "::0808:0808",
      "::8.8.8.8",
      "0:0:0:0:0:0:7f00:1",
      "64:ff9b::7f00:0001",
      "64:ff9b::127.0.0.1",
      "64:ff9b::0808:0808",
      "64:ff9b::169.254.169.254",
    ]) {
      expect(classifyIp(text), text).toBe("reserved");
      expect(evaluateAddress(text, permissivePolicy).allowed, text).toBe(false);
    }
    // The forms that genuinely are IPv6 keep their own classes.
    expect(classifyIp("::1")).toBe("loopback");
    expect(classifyIp("::")).toBe("unspecified");
    expect(classifyIp("2001:4860:4860::8888")).toBe("public");
  });

  test("an IPv6 literal with a dotted IPv4 tail parses to the same bytes", () => {
    for (const [dotted, hexed] of [
      ["::ffff:127.0.0.1", "::ffff:7f00:0001"],
      ["::1.2.3.4", "::0102:0304"],
      ["64:ff9b::1.2.3.4", "64:ff9b::0102:0304"],
      ["fd12:3456::1.2.3.4", "fd12:3456:0:0:0:0:0102:0304"],
      ["1:2:3:4:5:6:1.2.3.4", "1:2:3:4:5:6:0102:0304"],
    ] as const) {
      expect(parseIp(dotted), dotted).toBeDefined();
      expect(parseIp(dotted)?.bytes, dotted).toBe(parseIp(hexed)?.bytes);
    }
    // A unique-local address keeps its class however its tail is spelled.
    expect(classifyIp("fd12:3456::1.2.3.4")).toBe("ipv6ULA");
    for (const broken of [
      "::ffff:300.1.1.1",
      "1:2:3:4:5:6:7:1.2.3.4",
      "::1.2.3",
      "2001:db8::1.2.3.4.5",
      "::ffff:1.2.3.4.",
    ]) {
      expect(parseIp(broken), broken).toBeUndefined();
    }
  });

  test("a mapped literal hostname is judged and pinned as its IPv4 address", async () => {
    await expect(
      resolveApprovedAddresses("[::ffff:7f00:1]", defaultPolicy),
    ).rejects.toBeInstanceOf(AddressPolicyDeniedError);
    const { approved, verdicts } = await resolveApprovedAddresses(
      "[::ffff:127.0.0.1]",
      { ...defaultPolicy, allowLoopback: true },
    );
    expect(verdicts[0]?.networkClass).toBe("loopback");
    expect(verdicts[0]?.address).toBe("127.0.0.1");
    expect(approved).toEqual([{ address: "127.0.0.1", family: 4 }]);
  });

  test("the address the socket is pinned to is the address that was classified", async () => {
    const answers = [
      "::ffff:7f00:0001",
      "::ffff:127.0.0.1",
      "0:0:0:0:0:ffff:7f00:1",
    ];
    const { approved, verdicts } = await resolveApprovedAddresses(
      "pin.example",
      { ...defaultPolicy, allowLoopback: true },
      async () => answers,
    );
    const pinned = await lookupAll(pinnedLookup(approved), "pin.example");
    expect(pinned).toEqual(
      verdicts.map((verdict) => ({
        address: verdict.address,
        family: verdict.family,
      })),
    );
    for (const [index, verdict] of verdicts.entries()) {
      expect(verdict.networkClass).toBe("loopback");
      expect(parseIp(pinned[index]?.address ?? "")?.bytes).toBe(
        parseIp(verdict.address)?.bytes,
      );
      expect(classifyIp(pinned[index]?.address ?? "")).toBe(
        verdict.networkClass,
      );
    }
  });

  test("the provider denies a mapped-loopback URL and serves it once loopback is allowed", async () => {
    const server = await startFixture({ "/open": { body: "mapped-body" } });
    const origin = `http://[::ffff:7f00:1]:${server.port}`;
    const rule = (allowLoopback: boolean) =>
      fixtureRule(origin, {
        id: "mapped-loopback",
        match: {
          schemes: ["http"],
          hosts: ["[::ffff:7f00:1]"],
          ports: [server.port],
          allowPaths: ["/open"],
        },
        auth: { type: "none" },
        networkPolicy: { allowLoopback },
      });
    try {
      await expectWebError("AUTH_FETCH_NETWORK_DENIED", () =>
        newProvider(configWith([rule(false)])).provider.fetch({
          url: `${origin}/open`,
        }),
      );
      const result = await newProvider(configWith([rule(true)])).provider.fetch(
        { url: `${origin}/open` },
      );
      expect(result.statusCode).toBe(200);
      expect(result.body).toEqual({ kind: "text", content: "mapped-body" });
    } finally {
      await server.close();
    }
  });
});

/** Ask a pinned lookup for every address it will hand the socket. */
function lookupAll(
  lookup: LookupFunction,
  hostname: string,
): Promise<LookupAddress[]> {
  return new Promise((resolve, reject) => {
    lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error !== null) {
        reject(error);
        return;
      }
      resolve(addresses as LookupAddress[]);
    });
  });
}
