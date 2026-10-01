// @vitest-environment jsdom
/**
 * The QA Surface settings card: the shell contract, the path-addressed writes
 * behind the controls, the paired writes the Host's cross-checks force, and
 * the state the `qaSurface/describe` Remote feeds the status view.
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import type { ReactElement } from "react";

import type { QaSurfaceConfig } from "../../../src/types.js";
import { resolveConfig } from "../../../src/resolve-config.js";
import { QaSettingsCardEntry } from "../../../src/client/settings/card.js";

export const BASE = resolveConfig({});

export const EFFECTIVE = resolveConfig({
  route: { path: "/assistant" },
  accounts: { enabled: true },
});

export type ScopeSnapshot = {
  status: "loading" | "ready" | "unavailable";
  value: QaSurfaceConfig | undefined;
  base: unknown;
  user: unknown;
  revision: number | undefined;
  writable: boolean;
  mode: "host" | "memory";
};

/** One operation as the card sends it over the configuration form. */
interface PathOp {
  readonly op: "set" | "unset";
  readonly path: readonly string[];
  readonly value?: unknown;
}

function setPath(
  root: Record<string, unknown>,
  path: readonly string[],
  value: unknown,
): void {
  let cursor = root;
  for (const segment of path.slice(0, -1)) {
    const next = cursor[segment];
    cursor[segment] =
      typeof next === "object" && next !== null
        ? next
        : ({} as Record<string, unknown>);
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[path[path.length - 1] as string] = value;
}

function unsetPath(
  root: Record<string, unknown>,
  path: readonly string[],
): void {
  let cursor: Record<string, unknown> | undefined = root;
  for (const segment of path.slice(0, -1)) {
    if (cursor === undefined) return;
    const next: unknown = cursor[segment];
    cursor =
      typeof next === "object" && next !== null
        ? (next as Record<string, unknown>)
        : undefined;
  }
  if (cursor !== undefined) delete cursor[path[path.length - 1] as string];
}

/**
 * A settings document that behaves like the Host: an accepted write lands in
 * the section and advances the revision, a write that changes nothing leaves
 * the revision alone, and a refused write (`refuse`) does neither — while the
 * promise still settles, which is exactly what the card has to survive.
 */
export function makeForm(
  snapshot: Partial<ScopeSnapshot> = {},
  refuse = false,
): { form: unknown; mutate: ReturnType<typeof vi.fn> } {
  const listeners = new Set<() => void>();
  const current: ScopeSnapshot = {
    status: "ready",
    value: BASE,
    base: undefined,
    user: undefined,
    revision: 1,
    writable: true,
    mode: "host",
    ...snapshot,
  };
  const mutate = vi.fn(async (ops: readonly PathOp[]) => {
    if (refuse) return;
    const value = structuredClone(current.value) as Record<string, unknown>;
    const user = structuredClone(current.user ?? {}) as Record<string, unknown>;
    for (const op of ops) {
      if (op.op === "set") {
        setPath(value, op.path, op.value);
        setPath(user, op.path, op.value);
      } else {
        unsetPath(value, op.path);
        unsetPath(user, op.path);
      }
    }
    const changed = JSON.stringify(value) !== JSON.stringify(current.value);
    current.value = value as QaSurfaceConfig;
    current.user = user;
    if (changed) current.revision = (current.revision ?? 0) + 1;
    for (const listener of listeners) listener();
  });
  return {
    mutate,
    form: {
      getSnapshot: () => current,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      mutate,
      set: () => Promise.resolve(),
      unset: () => Promise.resolve(),
    },
  };
}

export type DescribeResult =
  { ok: true; value: typeof EFFECTIVE } | { ok: false; error: unknown };

/**
 * The component the row seat registers. The slot runtime props do not exist
 * outside the host: the seat hands the face (`settingsForm`, `describe`) and
 * spreads its own owner props (`view`, and a `form` of `{ state, mutate }`)
 * after it.
 */
export const Entry = QaSettingsCardEntry as unknown as (props: {
  settingsForm: unknown;
  describe: () => Promise<DescribeResult>;
  view?: "summary" | "page";
  form?: unknown;
}) => ReactElement;

export async function renderCard(
  options: {
    snapshot?: Partial<ScopeSnapshot>;
    refuse?: boolean;
    describe?: () => Promise<DescribeResult>;
  } = {},
): Promise<{
  container: ReturnType<typeof render>["container"];
  mutate: ReturnType<typeof vi.fn>;
}> {
  const { form, mutate } = makeForm(options.snapshot, options.refuse ?? false);
  const describe =
    options.describe ?? (async () => ({ ok: true as const, value: EFFECTIVE }));
  let result: ReturnType<typeof render> | undefined;
  // The card polls once on mount; awaiting inside act keeps that first update
  // inside the test rather than after it.
  await act(async () => {
    result = render(
      <Entry settingsForm={form} describe={describe} view="page" />,
    );
    await Promise.resolve();
  });
  return {
    container: (result as ReturnType<typeof render>).container,
    mutate,
  };
}

export function openCard(): void {
  fireEvent.click(
    screen.getByRole("button", { name: /Показать настройки: Помощник QA/u }),
  );
}

/**
 * One section of the card body. Tests reach it through the hook the section
 * carries rather than through the Russian title it paints.
 */
export function section(testId: string): HTMLElement {
  return screen.getByTestId(testId);
}

/** The heading a section answers to, by the name the operator reads. */
export function sectionHeading(testId: string, title: string): HTMLElement {
  return within(screen.getByTestId(testId)).getByRole("heading", {
    name: new RegExp(`^${title}`, "u"),
  });
}

/** The plate a refused or failed write raises, when there is one. */
export function errorPlate(): HTMLElement | null {
  return (
    screen.queryByTestId("qa-settings-write-error") ??
    screen.queryByTestId("qa-settings-host-error")
  );
}

/** Settle a queued mutation and the render it triggers. */
export async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
