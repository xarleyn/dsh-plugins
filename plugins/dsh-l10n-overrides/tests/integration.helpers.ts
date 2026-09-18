// @vitest-environment jsdom

import type { Context } from "@deepseek-ai/cordis";
import { afterEach, expect, vi } from "vitest";

export type LocaleId = "en" | "zh";

export type LocaleChangeListener = (snapshot: {
  active: LocaleId;
  locales: readonly { id: LocaleId; label: string }[];
  revision: number;
}) => void;

export class FakeLocaleRuntime {
  active: LocaleId;
  revision = 0;

  constructor(active: LocaleId) {
    this.active = active;
  }

  translate(namespace: string, key: string): string {
    return `original:${this.active}:${namespace}:${key}`;
  }

  getSnapshot() {
    return {
      active: this.active,
      locales: [
        { id: "zh" as const, label: "Chinese" },
        { id: "en" as const, label: "English" },
      ],
      revision: this.revision,
    };
  }

  subscribe(): () => void {
    return () => undefined;
  }

  bind(namespace: string): (key: string) => string {
    return (key) => this.translate(namespace, key);
  }
}

export interface ContextOptions {
  readonly onThrows?: boolean;
  readonly unsubscribeThrowsBeforeRemoveOnce?: boolean;
  readonly onUnsubscribe?: () => void;
}

export function createContext(
  locale: FakeLocaleRuntime | unknown,
  options: ContextOptions = {},
) {
  const listeners = new Set<LocaleChangeListener>();
  let registrations = 0;
  let unsubscribeAttempts = 0;
  const ctx = {
    locale,
    on(event: string, next: LocaleChangeListener): () => boolean {
      expect(event).toBe("locale/change");
      registrations += 1;
      if (options.onThrows === true) throw new Error("listener unavailable");
      listeners.add(next);
      let shouldThrowBeforeRemove =
        options.unsubscribeThrowsBeforeRemoveOnce === true;
      return () => {
        unsubscribeAttempts += 1;
        options.onUnsubscribe?.();
        if (shouldThrowBeforeRemove) {
          shouldThrowBeforeRemove = false;
          throw new Error("unsubscribe unavailable");
        }
        return listeners.delete(next);
      };
    },
  };

  return {
    ctx: ctx as unknown as Context,
    emit(active: LocaleId): void {
      if (locale instanceof FakeLocaleRuntime) {
        locale.active = active;
        locale.revision += 1;
        for (const listener of listeners) listener(locale.getSnapshot());
      }
    },
    get registrations(): number {
      return registrations;
    },
    get listenerCount(): number {
      return listeners.size;
    },
    get unsubscribeAttempts(): number {
      return unsubscribeAttempts;
    },
  };
}

export async function flushMutations(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
