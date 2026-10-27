import type { Agent } from "@deepseek-ai/dsh-agent";
import { describe, expect, it, vi } from "vitest";
import { QaRequestScheduler } from "../../src/request-scheduler.js";
import { fakeContext } from "../helpers/context-fakes.js";

function agent(id: string): Agent {
  return { id, status: "running", session: { id } } as unknown as Agent;
}
function fixture(
  limit = 2,
  familyBusy: (item: Agent) => boolean = () => false,
) {
  let ceiling = limit;
  let clock = 0;
  const roots: Agent[] = [];
  const queue = new QaRequestScheduler(
    () => ceiling,
    () => roots,
    () => clock,
    familyBusy,
  );
  const request = (id: string) => {
    const item = agent(id);
    roots.push(item);
    const abort = new AbortController();
    return { agent: item, abort, ready: queue.acquire(item, abort.signal) };
  };
  return {
    queue,
    roots,
    request,
    limit: (n: number) => {
      ceiling = n;
    },
    time: (n: number) => {
      clock = n;
    },
  };
}

describe("server request admission", () => {
  it("keeps a place while a background expert outlives its parent turn", async () => {
    let childRunning = true;
    const f = fixture(
      1,
      (item) => String(item.id) === "parent" && childRunning,
    );
    const parent = f.request("parent"),
      next = f.request("next");
    await parent.ready;
    f.queue.release(parent.agent, true);
    expect(f.queue.status("next")).toMatchObject({ active: 1, waiting: true });
    childRunning = false;
    expect(f.queue.status("next")).toMatchObject({ active: 1, waiting: false });
    await next.ready;
    f.queue.dispose();
  });
  it("reserves exactly two places under simultaneous requests and admits FIFO", async () => {
    const f = fixture();
    const order: string[] = [];
    const requests = Array.from({ length: 6 }, (_, n) => f.request(String(n)));
    for (const r of requests)
      void r.ready.then(() => order.push(String(r.agent.id)));
    await Promise.resolve();
    expect(order).toEqual(["0", "1"]);
    expect(f.queue.status("2")).toMatchObject({
      active: 2,
      queued: 4,
      waiting: true,
      position: 1,
    });
    for (const n of [0, 1, 2, 3]) {
      f.queue.release(requests[n]!.agent, true);
      await Promise.resolve();
      expect(f.queue.status().active).toBe(2);
    }
    await Promise.all(requests.map((r) => r.ready));
    expect(order).toEqual(["0", "1", "2", "3", "4", "5"]);
    f.queue.dispose();
  });

  it("cancels a waiting request and advances subsequent positions without spending a slot", async () => {
    const f = fixture();
    const a = f.request("a"),
      b = f.request("b"),
      c = f.request("c"),
      d = f.request("d");
    const rejected = expect(c.ready).rejects.toThrow("cancel fixture");
    c.abort.abort(new Error("cancel fixture"));
    await rejected;
    expect(f.queue.status("d")).toMatchObject({
      active: 2,
      queued: 1,
      position: 1,
    });
    f.queue.release(a.agent);
    await d.ready;
    expect(f.queue.status("d").waiting).toBe(false);
    await b.ready;
    f.queue.dispose();
  });

  it("holds an active slot during cancellation until the driver actually retires", async () => {
    const f = fixture(1);
    const a = f.request("a"),
      b = f.request("b");
    await a.ready;
    a.abort.abort();
    expect(f.queue.status("b")).toMatchObject({ active: 1, waiting: true });
    f.queue.release(a.agent);
    await b.ready;
    f.queue.dispose();
  });

  it("keeps a whole turn's slot across steps and makes its next turn rejoin the queue", async () => {
    const f = fixture(1);
    const a = f.request("a"),
      b = f.request("b");
    await a.ready;
    await f.queue.acquire(a.agent, a.abort.signal);
    expect(f.queue.status("b").waiting).toBe(true);
    f.queue.release(a.agent);
    await b.ready;
    const next = f.queue.acquire(a.agent, new AbortController().signal);
    expect(f.queue.status("a").position).toBe(1);
    f.queue.release(b.agent);
    await next;
    f.queue.dispose();
  });

  it("applies raised and lowered volatile limits without interrupting active work", async () => {
    const f = fixture();
    const a = f.request("a"),
      b = f.request("b"),
      c = f.request("c"),
      d = f.request("d");
    await Promise.all([a.ready, b.ready]);
    f.limit(3);
    expect(f.queue.status().active).toBe(3);
    await c.ready;
    f.limit(1);
    f.queue.release(a.agent);
    f.queue.release(b.agent);
    expect(f.queue.status("d").waiting).toBe(true);
    f.queue.release(c.agent);
    await d.ready;
    f.queue.dispose();
  });

  it("treats zero as unbounded and rejects an already cancelled request", async () => {
    const f = fixture(0);
    const requests = Array.from({ length: 5 }, (_, n) => f.request(String(n)));
    await Promise.all(requests.map((r) => r.ready));
    expect(f.queue.status()).toMatchObject({
      active: 5,
      queued: 0,
      full: false,
    });
    expect(() =>
      f.queue.acquire(
        agent("cancelled"),
        AbortSignal.abort(new Error("pre-cancelled")),
      ),
    ).toThrow("pre-cancelled");
    f.queue.dispose();
  });

  it("does not fabricate wait estimates before three completed turns", async () => {
    const f = fixture(1);
    for (let n = 0; n < 3; n++) {
      f.time(n * 60000);
      const item = f.request(String(n));
      await item.ready;
      f.time((n + 1) * 60000);
      f.queue.release(item.agent, true);
    }
    const a = f.request("active"),
      b = f.request("waiting");
    await a.ready;
    expect(f.queue.status("waiting").estimatedWaitMs).toBe(60000);
    f.time(210000);
    expect(f.queue.status("waiting").estimatedWaitMs).toBe(30000);
    f.time(241000);
    expect(f.queue.status("waiting").estimatedWaitMs).toBeNull();
    f.queue.release(a.agent);
    await b.ready;
    f.queue.dispose();
    const cold = fixture(1);
    const x = cold.request("x"),
      y = cold.request("y");
    await x.ready;
    expect(cold.queue.status("y").estimatedWaitMs).toBeNull();
    const failed = expect(y.ready).rejects.toThrow("unloaded");
    cold.queue.dispose();
    await failed;
  });

  it("rejects pending work and removes listeners when the scheduler unloads", async () => {
    const f = fixture(1);
    const a = f.request("a"),
      b = f.request("b");
    await a.ready;
    const rejected = expect(b.ready).rejects.toThrow("unloaded");
    f.queue.dispose();
    await rejected;
    await expect(
      f.queue.acquire(agent("new"), new AbortController().signal),
    ).rejects.toThrow("unavailable");
  });

  it("gates root pre-steps, lets children run inside the lease, and releases on actual turn end", async () => {
    const f = fixture(1),
      ctx = fakeContext();
    const dispose = f.queue.install(ctx.context);
    const a = agent("root-a"),
      b = agent("root-b"),
      child = agent("child");
    f.roots.push(a, b);
    const pre = ctx.handler("agent/pre-step") as (
      p: { agent: Agent; signal: AbortSignal },
      next: () => Promise<{ kind: "reject" }>,
    ) => Promise<unknown>;
    const first = vi.fn(async () => ({ kind: "reject" as const }));
    const second = vi.fn(async () => ({ kind: "reject" as const }));
    await pre({ agent: a, signal: new AbortController().signal }, first);
    const pending = pre(
      { agent: b, signal: new AbortController().signal },
      second,
    );
    await pre({ agent: child, signal: new AbortController().signal }, first);
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).not.toHaveBeenCalled();
    const end = ctx.handler("session/event") as (
      session: Agent["session"],
      event: unknown,
    ) => void;
    end(a.session, {
      type: "turn/end",
      data: { reason: { kind: "completed" } },
    });
    await pending;
    expect(second).toHaveBeenCalledOnce();
    dispose();
  });
});
