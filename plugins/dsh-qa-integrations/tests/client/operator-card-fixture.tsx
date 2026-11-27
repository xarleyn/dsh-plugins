import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { OperatorCard } from "../../src/client/operator-card.js";

/** The slot props the Plugins page supplies are outside this test's concern. */
export const Card = OperatorCard as unknown as (props: {
  settingsForm: unknown;
}) => ReactElement;

interface ScopeOp {
  readonly op: string;
  readonly path: readonly string[];
  readonly value?: unknown;
}

interface ScopeStub {
  readonly writes: ScopeOp[];
  setStatus(status: "ready" | "unavailable"): void;
}

export function scopeStub(initial: {
  value?: unknown;
  user?: unknown;
  writable?: boolean;
  status?: "ready" | "unavailable";
}): { settingsForm: never; stub: ScopeStub } {
  let snapshot = {
    status: (initial.status ?? "ready") as "ready" | "unavailable",
    value: initial.value,
    base: undefined as unknown,
    user: initial.user,
    revision: 1,
    writable: initial.writable ?? true,
  };
  const listeners = new Set<() => void>();
  const writes: ScopeOp[] = [];
  const publish = () => {
    for (const listener of [...listeners]) listener();
  };
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    mutate: async (ops: readonly ScopeOp[]) => {
      const user = { ...((snapshot.user ?? {}) as Record<string, unknown>) };
      for (const op of ops) {
        writes.push(op);
        const segments = op.path.slice(0, -1);
        const leaf = op.path[op.path.length - 1] ?? "";
        let cursor = user;
        for (const segment of segments) {
          const next = {
            ...((cursor[segment] ?? {}) as Record<string, unknown>),
          };
          cursor[segment] = next;
          cursor = next;
        }
        if (op.op === "set") cursor[leaf] = op.value;
        else delete cursor[leaf];
      }
      snapshot = { ...snapshot, user };
      publish();
    },
    set: async () => {},
    unset: async () => {},
  };
  return {
    settingsForm: scope as never,
    stub: {
      writes,
      setStatus(status) {
        snapshot = { ...snapshot, status };
        publish();
      },
    },
  };
}

export function renderCard(initial: {
  value?: unknown;
  user?: unknown;
  writable?: boolean;
  status?: "ready" | "unavailable";
}): ScopeStub {
  const { settingsForm, stub } = scopeStub(initial);
  render(<Card settingsForm={settingsForm} />);
  return stub;
}
