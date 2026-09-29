/**
 * A tool says out loud what the service ceiling will refuse.
 *
 * The ceiling is a property of the provider's catalog, not of the user's token,
 * so a model that only learns it from the refusal goes looking for a fault in
 * the stand's integration — which is what issue #285 reported. The kit composes
 * the notice into the description from the operation's own classification, and
 * this test reads the built surface back: a tool whose operation the ceiling
 * refuses says so, and a tool it allows does not. That holds for every provider,
 * so the wording cannot come back on TeamCity alone, and it cannot drift from a
 * reclassified operation.
 *
 * The other half is the stand that hands out no managed credential: there the
 * ceiling is not a condition anyone meets, so no description may mention it. A
 * warning about a ceiling that is not there withholds a reading the personal
 * connection would answer, which is the same failure #285 is about.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BITRIX_OPERATIONS } from "../../src/providers/bitrix24/catalog.js";
import { CONFLUENCE_OPERATIONS } from "../../src/providers/confluence/catalog.js";
import { GITLAB_OPERATIONS } from "../../src/providers/gitlab/catalog.js";
import { JIRA_OPERATIONS } from "../../src/providers/jira/catalog.js";
import {
  SERVICE_CEILING_NOTICE,
  serviceCeilingRefusedReading,
} from "../../src/providers/shared/service-boundary.js";
import { TEAMCITY_OPERATIONS } from "../../src/providers/teamcity/catalog.js";
import { TESTIT_OPERATIONS } from "../../src/providers/testit/catalog.js";
import { WEBLATE_OPERATIONS } from "../../src/providers/weblate/catalog.js";
import type { OperationSecurityMetadata } from "../../src/service-credentials/types.js";
import { createIntegrationTools } from "../../src/tools.js";

interface Surface {
  readonly name: string;
  readonly description: string;
}

function surface(managedServiceCredentialsEnabled: boolean) {
  const tools = createIntegrationTools({
    broker: { call: async () => undefined } as never,
    principalForSession: () => undefined,
    managedServiceCredentialsEnabled,
  }) as unknown as readonly Surface[];
  return new Map(tools.map((tool) => [tool.name, tool]));
}

/**
 * The `tool({ … })` blocks of one provider's source, each paired with the
 * catalog operation it executes. The pairing is textual because a built tool
 * keeps no trace of its operation; the count check below is what makes a
 * misparsed block fail loudly instead of dropping a tool out of the comparison.
 */
function declared(
  path: string,
  prefix: string,
): ReadonlyArray<{ name: string; operation: string }> {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  return source
    .split(/\btool\(\{/u)
    .slice(1)
    .map((chunk) => ({
      name: /^\s*name: "([^"]+)"/mu.exec(chunk)?.[1] ?? "",
      operation: /^\s*operation: "([^"]+)"/mu.exec(chunk)?.[1] ?? "",
    }))
    .filter((entry) => entry.name.startsWith(prefix));
}

/**
 * Each provider's catalog and the prefix its tool names carry. The prefix is
 * spelled out rather than taken from the provider id because Bitrix24 names its
 * tools `bitrix_*`: a derived prefix matched nothing on either side, and the
 * comparison stayed green over the largest block of notices on the surface.
 */
const PROVIDERS = Object.freeze({
  bitrix24: { operations: BITRIX_OPERATIONS, toolPrefix: "bitrix_" },
  confluence: {
    operations: CONFLUENCE_OPERATIONS,
    toolPrefix: "confluence_",
  },
  gitlab: { operations: GITLAB_OPERATIONS, toolPrefix: "gitlab_" },
  jira: { operations: JIRA_OPERATIONS, toolPrefix: "jira_" },
  teamcity: { operations: TEAMCITY_OPERATIONS, toolPrefix: "teamcity_" },
  testit: { operations: TESTIT_OPERATIONS, toolPrefix: "testit_" },
  weblate: { operations: WEBLATE_OPERATIONS, toolPrefix: "weblate_" },
});

describe("integration tools: what the service ceiling refuses", () => {
  const built = surface(true);

  for (const [provider, { operations, toolPrefix }] of Object.entries(
    PROVIDERS,
  )) {
    it(`says the condition on every ${provider} reading the ceiling denies`, () => {
      const entries = declared(
        `../../src/providers/${provider}/tools.ts`,
        toolPrefix,
      );
      // Both sides of the comparison have to hold tools: an empty set matches an
      // empty set, which is how a provider could drop out of this check.
      expect(entries.length, provider).toBeGreaterThan(0);
      const own = [...built.keys()].filter((name) =>
        name.startsWith(toolPrefix),
      );
      expect(entries, provider).toHaveLength(own.length);

      for (const { name, operation } of entries) {
        const security = operations[operation] as
          { security: OperationSecurityMetadata } | undefined;
        // An unclassified operation would be refused by both locks, so a tool
        // that names one is a catalog gap rather than a wording question.
        expect(security, `${provider}.${operation}`).toBeDefined();
        const tool = built.get(name);
        expect(tool, name).toBeDefined();
        expect(tool?.description.endsWith(SERVICE_CEILING_NOTICE), name).toBe(
          serviceCeilingRefusedReading(security?.security),
        );
      }
    });
  }

  it("says nothing about a ceiling this stand never meets", () => {
    // A deployment without managed credentials answers every one of these
    // readings on the user's own connection, so the warning would be a reason
    // not to call a tool that works — and the mounted set must not shift with it.
    const personal = surface(false);
    expect(personal.size).toBe(built.size);
    for (const [name, tool] of personal) {
      expect(tool.description.endsWith(SERVICE_CEILING_NOTICE), name).toBe(
        false,
      );
    }
  });

  it("warns about the reading the report was about, and not its summary", () => {
    // teamcity_build_log is the call that failed in the session log, while
    // teamcity_build_failures answers the same question on a service token.
    expect(
      built
        .get("teamcity_build_log")
        ?.description.endsWith(SERVICE_CEILING_NOTICE),
    ).toBe(true);
    expect(
      built
        .get("teamcity_build_failures")
        ?.description.endsWith(SERVICE_CEILING_NOTICE),
    ).toBe(false);
    // The same ceiling that denies a TeamCity log denies a GitLab job trace.
    expect(
      built
        .get("gitlab_job_log_get")
        ?.description.endsWith(SERVICE_CEILING_NOTICE),
    ).toBe(true);
  });
});
