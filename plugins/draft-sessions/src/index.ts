/**
 * Draft Sessions Plugin — manage session drafts and previews.
 */

// Import from plugin-kit package
import { createLogger, satisfiesVersion } from "@scope/dsh-plugin-kit";

const logger = createLogger("draft-sessions");

export interface DraftSession {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface DraftSessionsConfig {
  maxDrafts?: number;
  autoSaveInterval?: number;
}

const DEFAULT_CONFIG: Required<DraftSessionsConfig> = {
  maxDrafts: 50,
  autoSaveInterval: 30_000,
};

/**
 * Initialize the draft sessions plugin.
 */
export async function initialize(
  config: DraftSessionsConfig = {},
): Promise<void> {
  const merged = { ...DEFAULT_CONFIG, ...config };

  logger.info("Draft sessions plugin initialized", {
    maxDrafts: merged.maxDrafts,
    autoSaveInterval: merged.autoSaveInterval,
  });
}

/**
 * Create a new draft session.
 */
export function createDraft(
  title: string,
  content: string,
): DraftSession {
  const now = Date.now();

  return {
    id: `draft-${now}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    content,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Check DSH compatibility.
 */
export function checkCompatibility(): boolean {
  const rawVersion = (globalThis as Record<string, unknown>)["__DSH_VERSION__"];
  const version: string = typeof rawVersion === "string" ? rawVersion : "0.0.0";

  return satisfiesVersion(version, "4.0.0");
}

export { logger };
