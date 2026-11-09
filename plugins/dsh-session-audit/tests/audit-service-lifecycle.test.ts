import { EventEmitter } from "node:events";
import { setImmediate } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { root } from "./host-pipeline.helpers.js";
import {
  AUDIT_DIRECTORY,
  REPORT,
  SESSION_ID,
  analysis,
  testService,
  writeAudit,
} from "./helpers/fixtures.js";

const { watch } = vi.hoisted(() => ({ watch: vi.fn() }));
vi.mock("chokidar", () => ({ watch }));
afterEach(() => {
  watch.mockReset();
});

function watcherWithClose(close: () => Promise<void>) {
  return Object.assign(new EventEmitter(), { close });
}

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

  it("drains the active scan and drops retained audit data when watcher close rejects", async () => {
    const failure = new Error("watcher close failed");
    watch.mockReturnValueOnce(watcherWithClose(() => Promise.reject(failure)));
    const entered = Promise.withResolvers<void>();
    const listing = Promise.withResolvers<readonly string[]>();
    const { service } = testService(root, {
      config: { watch: true },
      listSessionIds: () => {
        entered.resolve();
        return listing.promise;
      },
    });
    await service.start();
    await writeAudit(root, AUDIT_DIRECTORY, {
      analysis: { schemaVersion: 7, trajectory: {} },
      report: REPORT,
    });
    const refreshing = service.refresh();
    await entered.promise;
    let stopSettled = false;
    const stopping = service.stop().catch((error: unknown) => {
      stopSettled = true;
      return error;
    });
    await setImmediate();
    const settledBeforeScan = stopSettled;
    listing.resolve([SESSION_ID]);
    expect((await refreshing).ready).toBe(1);
    expect(await stopping).toBe(failure);
    expect(settledBeforeScan).toBe(false);
    expect(service.registry.get(AUDIT_DIRECTORY)).toBeUndefined();
    expect(await service.readReport(AUDIT_DIRECTORY)).toBeNull();
  });

  it("can start again after a queued restart observes a failed close", async () => {
    const failure = new Error("watcher close failed");
    const closing = Promise.withResolvers<void>();
    const closeAfterRetry = vi.fn(() => Promise.resolve());
    watch
      .mockReturnValueOnce(watcherWithClose(() => closing.promise))
      .mockReturnValueOnce(watcherWithClose(closeAfterRetry));
    const { service } = testService(root, { config: { watch: true } });
    await service.start();
    const stopFails = expect(service.stop()).rejects.toBe(failure);
    const restartFails = expect(service.start()).rejects.toBe(failure);
    closing.reject(failure);
    await Promise.all([stopFails, restartFails]);

    await writeAudit(root, AUDIT_DIRECTORY, {
      analysis: analysis(),
      report: REPORT,
    });
    await service.start();
    expect(watch).toHaveBeenCalledTimes(2);
    expect(await service.getSessionAuditSummary(SESSION_ID)).not.toBeNull();
    await service.stop();
    expect(closeAfterRetry).toHaveBeenCalledOnce();
  });

  it("keeps a queued restart active when the earlier startup scan fails", async () => {
    const failure = new Error("scan failed");
    const entered = Promise.withResolvers<void>();
    const listing = Promise.withResolvers<readonly string[]>();
    watch.mockReturnValueOnce(watcherWithClose(() => Promise.resolve()));
    const { service, logger } = testService(root, {
      config: { watch: true },
      listSessionIds: () => {
        entered.resolve();
        return listing.promise;
      },
    });
    await writeAudit(root, AUDIT_DIRECTORY, {
      analysis: { schemaVersion: 7, trajectory: {} },
      report: REPORT,
    });
    vi.spyOn(logger, "debug").mockImplementationOnce(() => {
      throw failure;
    });
    const firstStartFails = expect(service.start()).rejects.toBe(failure);
    await entered.promise;
    const stopping = service.stop();
    const restarting = service.start();
    listing.resolve([SESSION_ID]);
    await Promise.all([firstStartFails, stopping, restarting]);
    expect(watch).toHaveBeenCalledOnce();
    expect(await service.getSessionAuditSummary(SESSION_ID)).not.toBeNull();
    await service.stop();
  });
});
