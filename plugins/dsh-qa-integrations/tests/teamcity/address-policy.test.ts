import {
  networkAllowsNothing,
  resolveTeamCityConfig,
} from "../../src/providers/teamcity/config.js";
import {
  cidrProblem,
  hostPatternProblem,
  PRIVATE_CIDRS,
  serverUrlProblem,
} from "../../src/providers/teamcity/network.js";
import { config, NETWORK, SERVER } from "./shared.js";

describe("teamcity address policy", () => {
  it("canonicalizes the allowlist it is given", () => {
    const flags = resolveTeamCityConfig({
      network: {
        ...NETWORK,
        allowedHosts: ["TeamCity.Example.COM", "*.Corp.Example"],
      },
    });
    expect(flags.network).toEqual({
      mode: "allowlist",
      allowedHosts: ["teamcity.example.com", "*.corp.example"],
      allowedCidrs: ["10.20.0.0/16"],
      allowedPorts: [443, 8111],
      allowHttp: false,
    });
    expect(() =>
      resolveTeamCityConfig({ network: { mode: "yolo" } as never }),
    ).toThrow(/network.mode/u);
  });

  it("stays inert by default and says so instead of failing to load", () => {
    // A deployment that mounts no TeamCity still has to start, so the empty
    // policy is a state rather than an error — one the plugin logs.
    const empty = resolveTeamCityConfig();
    expect(networkAllowsNothing(empty.network)).toBe(true);
    expect(serverUrlProblem(SERVER, empty.network)).toBeDefined();
    expect(
      networkAllowsNothing(resolveTeamCityConfig({ network: NETWORK }).network),
    ).toBe(false);
  });

  it("fails loudly on an operator typo instead of dropping an entry", () => {
    for (const allowedHosts of [
      ["10.0.0.7"],
      ["*corp.example"],
      ["host name"],
    ]) {
      expect(() =>
        resolveTeamCityConfig({ network: { allowedHosts } }),
      ).toThrow(/allowedHosts/u);
    }
    for (const allowedCidrs of [["10.0.0.0/33"], ["10.0.0"], ["nope"]]) {
      expect(() =>
        resolveTeamCityConfig({ network: { allowedCidrs } }),
      ).toThrow(/allowedCidrs/u);
    }
    expect(hostPatternProblem("*.corp.example")).toBeUndefined();
    expect(cidrProblem("192.168.0.0/16")).toBeUndefined();
    // Ports are explicit: an unlisted port is refused rather than guessed at.
    expect(
      resolveTeamCityConfig({ network: { ...NETWORK, allowedPorts: [8111] } })
        .network.allowedPorts,
    ).toEqual([8111]);
  });

  it("takes private ranges as the default only in trusted-private mode", () => {
    const trusted = resolveTeamCityConfig({
      network: { mode: "trusted-private", allowHttp: true },
    });
    expect(trusted.network.allowedCidrs).toEqual(PRIVATE_CIDRS);
    // Plain HTTP implies the scheme's own port unless the operator names more.
    expect(trusted.network.allowedPorts).toEqual([80]);
    expect(
      resolveTeamCityConfig({ network: { mode: "trusted-private" } }).network
        .allowedPorts,
    ).toEqual([443]);
  });

  it("refuses addresses the deployment did not allow", () => {
    const allowed: readonly string[] = [
      "https://teamcity.example.com",
      "https://teamcity.example.com/teamcity",
      "https://ci.corp.example",
      "https://teamcity.example.com:8111",
      "https://10.20.1.5",
    ];
    for (const url of allowed) {
      expect(serverUrlProblem(url, config().teamcity.network)).toBeUndefined();
    }
    const refused: readonly string[] = [
      // Not in the allowlist, or an address where a name belongs.
      "https://evil.example.com",
      "https://10.21.1.5",
      "https://teamcity.example.com.evil.net",
      // Plain HTTP, a port nobody allowed, credentials or a query in the URL.
      "http://teamcity.example.com",
      "https://teamcity.example.com:8080",
      "https://user:pw@teamcity.example.com",
      "https://teamcity.example.com?x=1",
      "ftp://teamcity.example.com",
      "teamcity.example.com",
      "",
    ];
    for (const url of refused) {
      expect(
        serverUrlProblem(url, config().teamcity.network),
        url,
      ).toBeDefined();
    }
    // A wildcard never matches the domain itself, and plain HTTP needs the
    // deployment's explicit consent.
    expect(
      serverUrlProblem("https://corp.example", config().teamcity.network),
    ).toBeDefined();
    expect(
      serverUrlProblem(
        "http://teamcity.example.com",
        config().teamcity.network,
      ),
    ).toBeDefined();
    expect(
      serverUrlProblem(
        "http://teamcity.example.com",
        resolveTeamCityConfig({
          network: { ...NETWORK, allowHttp: true, allowedPorts: [80] },
        }).network,
      ),
    ).toBeUndefined();
  });
});
