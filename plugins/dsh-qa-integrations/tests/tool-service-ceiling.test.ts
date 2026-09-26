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
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BITRIX_OPERATIONS } from "../src/providers/bitrix24/catalog.js";
import { CONFLUENCE_OPERATIONS } from "../src/providers/confluence/catalog.js";
import { GITLAB_OPERATIONS } from "../src/providers/gitlab/catalog.js";
import { JIRA_OPERATIONS } from "../src/providers/jira/catalog.js";
import {
  SERVICE_CEILING_NOTICE,
  serviceCeilingRefusedReading,
} from "../src/providers/shared/service-boundary.js";
import { TEAMCITY_OPERATIONS } from "../src/providers/teamcity/catalog.js";
import { TESTIT_OPERATIONS } from "../src/providers/testit/catalog.js";
import { WEBLATE_OPERATIONS } from "../src/providers/weblate/catalog.js";
import type { OperationSecurityMetadata } from "../src/service-credentials/types.js";
import { createIntegrationTools } from "../src/tools.js";

interface Surface {
  readonly name: string;
  readonly description: string;
}

function surface(): ReadonlyMap<string, Surface> {
  const tools = createIntegrationTools({
    broker: { call: async () => undefined } as never,
    principalForSession: () => undefined,
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

const PROVIDERS = Object.freeze({
  bitrix24: BITRIX_OPERATIONS,
  confluence: CONFLUENCE_OPERATIONS,
  gitlab: GITLAB_OPERATIONS,
  jira: JIRA_OPERATIONS,
  teamcity: TEAMCITY_OPERATIONS,
  testit: TESTIT_OPERATIONS,
  weblate: WEBLATE_OPERATIONS,
});

describe("integration tools: what the service ceiling refuses", () => {
  const built = surface();

  for (const [provider, operations] of Object.entries(PROVIDERS)) {
    it(`says the condition on every ${provider} reading the ceiling denies`, () => {
      const entries = declared(
        `../src/providers/${provider}/tools.ts`,
        `${provider}_`,
      );
      const own = [...built.keys()].filter((name) =>
        name.startsWith(`${provider}_`),
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
