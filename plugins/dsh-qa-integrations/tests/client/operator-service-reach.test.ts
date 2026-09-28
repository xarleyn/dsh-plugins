/**
 * The operator card tells an operator which capability switches the managed
 * service credential will not honour — the gap issue #285 is about: `logsRead`
 * is on, and the tester on the read-only service account still cannot read a
 * build log.
 *
 * That statement is a copy of what each provider catalog already classifies, and
 * a copy has to be checked against its original: the client bundle cannot import
 * a catalog, so the table lives in `src/client/operator-service-reach.ts` and
 * this test recomputes it from every provider's own operations. It fails in both
 * directions — a switch annotated that the catalog reaches, and a switch the
 * catalog refuses that the card stays silent about. The other half of the chain,
 * table to rendered card, is counted by `tests/client/operator-card.test.tsx`.
 */

import { describe, expect, it } from "vitest";
import {
  SERVICE_REACH,
  SERVICE_REACH_NOTE,
  serviceReachNote,
  serviceReachNoteForPath,
  type ServiceReach,
} from "../../src/client/operator-service-reach.js";
import {
  BITRIX_CAPABILITIES,
  BITRIX_OPERATIONS,
} from "../../src/providers/bitrix24/catalog.js";
import {
  CONFLUENCE_CAPABILITIES,
  CONFLUENCE_OPERATIONS,
} from "../../src/providers/confluence/catalog.js";
import {
  GITLAB_CAPABILITIES,
  GITLAB_OPERATIONS,
} from "../../src/providers/gitlab/catalog.js";
import {
  JIRA_CAPABILITIES,
  JIRA_OPERATIONS,
} from "../../src/providers/jira/catalog.js";
import {
  TEAMCITY_CAPABILITIES,
  TEAMCITY_OPERATIONS,
} from "../../src/providers/teamcity/catalog.js";
import {
  TESTIT_CAPABILITIES,
  TESTIT_OPERATIONS,
} from "../../src/providers/testit/catalog.js";
import {
  WEBLATE_CAPABILITIES,
  WEBLATE_OPERATIONS,
} from "../../src/providers/weblate/catalog.js";
import { evaluateServiceOperation } from "../../src/service-credentials/policy.js";
import type {
  OperationSecurityMetadata,
  ServiceCredentialProfile,
} from "../../src/service-credentials/types.js";

interface Catalog {
  readonly capabilities: ReadonlyArray<{
    readonly capability: string;
    readonly flag: string;
  }>;
  readonly operations: Readonly<
    Record<
      string,
      {
        readonly capability: string;
        readonly security: OperationSecurityMetadata;
      }
    >
  >;
}

const CATALOGS: Readonly<Record<string, Catalog>> = Object.freeze({
  bitrix24: {
    capabilities: BITRIX_CAPABILITIES,
    operations: BITRIX_OPERATIONS,
  },
  confluence: {
    capabilities: CONFLUENCE_CAPABILITIES,
    operations: CONFLUENCE_OPERATIONS,
  },
  gitlab: {
    capabilities: GITLAB_CAPABILITIES,
    operations: GITLAB_OPERATIONS,
  },
  jira: { capabilities: JIRA_CAPABILITIES, operations: JIRA_OPERATIONS },
  teamcity: {
    capabilities: TEAMCITY_CAPABILITIES,
    operations: TEAMCITY_OPERATIONS,
  },
  testit: { capabilities: TESTIT_CAPABILITIES, operations: TESTIT_OPERATIONS },
  weblate: {
    capabilities: WEBLATE_CAPABILITIES,
    operations: WEBLATE_OPERATIONS,
  },
});

/**
 * A profile with a bounded, unnarrowed policy: the boundary is satisfied for
 * every kind a provider names, so the only thing left to decide is the ceiling
 * this test is about.
 */
const PROFILE = Object.freeze({
  id: "svc",
  provider: "teamcity",
  instance: "teamcity",
  portal: "ci.example",
  label: "CI Read-only",
  authType: "token",
  secretRef: "env:CI_SERVICE_TOKEN",
  enabled: true,
  resources: Object.freeze({
    projects: Object.freeze(["alpha"]),
    spaces: Object.freeze(["DEV"]),
    portals: Object.freeze(["crm.example"]),
  }),
  policy: Object.freeze({}),
  policyRevision: "rev1",
}) satisfies ServiceCredentialProfile;

/** Whether the managed credential reaches one operation at all. */
function reachesCeiling(
  security: OperationSecurityMetadata,
  capability: string,
): boolean {
  return (
    evaluateServiceOperation({
      metadata: security,
      capability,
      profile: PROFILE,
      boundaryKind: "projects",
    }).allowed === true
  );
}

/**
 * The switches of one catalog the card has to annotate, derived from the
 * operations that stand behind them. A capability with an operation that writes
 * is left out on purpose: the card words a write differently — it is outside a
 * read-only credential whatever its answer is — and this table answers only the
 * question «why was a reading refused».
 */
function expectedSwitches(catalog: Catalog): Record<string, ServiceReach> {
  const tallied: Record<string, { allowed: number; refused: number }> = {};
  for (const { capability, flag } of catalog.capabilities) {
    const operations = Object.values(catalog.operations).filter(
      (definition) => definition.capability === capability,
    );
    if (
      operations.some((definition) => definition.security.effect !== "read")
    ) {
      continue;
    }
    const tally = (tallied[flag] ??= { allowed: 0, refused: 0 });
    for (const definition of operations) {
      if (reachesCeiling(definition.security, capability)) tally.allowed += 1;
      else tally.refused += 1;
    }
  }
  const expected: Record<string, ServiceReach> = {};
  for (const [switchName, tally] of Object.entries(tallied)) {
    if (tally.refused === 0) continue;
    expected[switchName] = tally.allowed === 0 ? "whole" : "part";
  }
  return expected;
}

describe("integrations operator card: service credential reach", () => {
  for (const [provider, catalog] of Object.entries(CATALOGS)) {
    it(`annotates exactly the ${provider} switches the catalog refuses`, () => {
      const annotated =
        (
          SERVICE_REACH as Readonly<
            Record<string, Readonly<Record<string, ServiceReach>>>
          >
        )[provider] ?? {};
      expect({ ...annotated }).toEqual(expectedSwitches(catalog));
    });
  }

  it("annotates no provider the catalogs do not know", () => {
    // A row for a provider nobody imports would be checked by no case above, so
    // the table could rot in silence while its provider's ceiling moved on.
    expect(
      Object.keys(SERVICE_REACH).filter((provider) => !(provider in CATALOGS)),
    ).toEqual([]);
  });

  it("says what to do about it, not only that it is refused", () => {
    for (const notes of Object.values(SERVICE_REACH)) {
      for (const [switchName, reach] of Object.entries(notes)) {
        const note = SERVICE_REACH_NOTE[reach];
        expect(note, switchName).toContain("личный аккаунт");
      }
    }
  });

  it("names the TeamCity log switch the stand had enabled", () => {
    // The exact case of the report: logsRead is on, and it is still not the
    // integration's fault that a service-token chat cannot read a build log.
    // `serviceReachNote` takes the switch as a key of that provider's row, so a
    // mistyped one is a compile error rather than a silently missing note.
    expect(serviceReachNote("teamcity", "logsRead", true)).toContain(
      "личный аккаунт",
    );
    // A switch the credential does reach keeps its row clean — read the way the
    // card reads it, by the toggle's own configuration path.
    expect(serviceReachNoteForPath(["teamcity", "failuresRead"], true)).toBe(
      undefined,
    );
    expect(serviceReachNoteForPath(["gitlab", "ciMetadataRead"], true)).toBe(
      undefined,
    );
    // The note addresses a switch, never a whole section or another slice's key.
    expect(serviceReachNoteForPath(["teamcity"], true)).toBeUndefined();
    expect(
      serviceReachNoteForPath(["managedServiceCredentials", "enabled"], true),
    ).toBeUndefined();
  });

  it("stays silent while the deployment hands out no managed credential", () => {
    expect(serviceReachNote("teamcity", "logsRead", false)).toBeUndefined();
    expect(serviceReachNoteForPath(["teamcity", "logsRead"], false)).toBe(
      undefined,
    );
  });
});
