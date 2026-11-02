import { getEventListeners } from "node:events";
import { expect, test } from "vitest";
import { createSemaphore } from "../src/documents/security/limits.js";

test("granted and cancelled semaphore waiters release their abort listeners", async () => {
  const semaphore = createSemaphore(1);
  const caller = new AbortController();
  for (let index = 0; index < 3; index += 1) {
    const held = await semaphore.acquire();
    const waiting = semaphore.acquire(caller.signal);
    held();
    const release = await waiting;
    expect(getEventListeners(caller.signal, "abort")).toHaveLength(0);
    release();
  }
  const held = await semaphore.acquire();
  const waiting = semaphore.acquire(caller.signal);
  caller.abort();
  await expect(waiting).rejects.toMatchObject({ code: "INVALID_INPUT" });
  held();
  expect(semaphore.inUse).toBe(0);
  expect(getEventListeners(caller.signal, "abort")).toHaveLength(0);
});
