import { describe, expect, it } from "vitest";
import { root } from "./host-pipeline.helpers.js";
import {
  AUDIT_DIRECTORY,
  REPORT,
  SESSION_ID,
  testService,
  writeAudit,
} from "./helpers/fixtures.js";

describe("AuditService stop barrier", () => {
  it.each([false, true])(
    "does not retain an interrupted scan (restart=%s)",
    async (restart) => {
      let resolve!: (ids: readonly string[]) => void;
      let entered!: () => void;
      const inListing = new Promise<void>((done) => {
        entered = done;
      });
      const listing = new Promise<readonly string[]>((done) => {
        resolve = done;
      });
      const { service } = testService(root, {
        listSessionIds: () => {
          entered();
          return listing;
        },
      });
      await writeAudit(root, AUDIT_DIRECTORY, {
        analysis: { schemaVersion: 7, trajectory: {} },
        report: REPORT,
      });
      const starting = service.start();
      await inListing;
      const stopping = service.stop();
      const restarting = restart ? service.start() : Promise.resolve();
      resolve([SESSION_ID]);
      await Promise.all([starting, stopping, restarting]);
      if (restart) {
        expect(await service.getSessionAuditSummary(SESSION_ID)).not.toBeNull();
        await service.stop();
      }
      expect(service.registry.counts()).toEqual({
        ready: 0,
        invalid: 0,
        unresolved: 0,
      });
      await service.refresh();
      expect(service.registry.counts()).toEqual({
        ready: 0,
        invalid: 0,
        unresolved: 0,
      });
    },
  );
});
