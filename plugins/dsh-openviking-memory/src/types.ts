/**
 * Wire types crossing the Remote boundary.
 *
 * Typert requires every type a Remote method takes or returns to be reachable
 * from a non-root subpath of the package (`./types`), because the browser
 * bundle imports the generated schemas rather than the Host implementation.
 * Keep this module dependency-free: it is loaded by the client half, which must
 * not pull `node:fs` or the Host config surface into the page.
 */

/** One remembered topic inside a memory section. */
export interface QaMemoryOverviewItem {
  /** Display name of the entry: its last path segment, without `.md`. */
  readonly name: string;
  /** The description the memory store wrote for it; empty when it wrote none. */
  readonly summary: string;
  /** Whether the entry is a folder holding further notes. */
  readonly folder: boolean;
}

/** One memory section — how the store files what it remembered. */
export interface QaMemoryOverviewGroup {
  /** Raw section name on disk (`cases`, `entities`, …); the page labels it. */
  readonly name: string;
  /** Section title for the page, derived from {@link name}. */
  readonly title: string;
  /** The section's own description, when the store generated one. */
  readonly summary: string;
  /** The first entries; {@link total} says how many the section holds. */
  readonly items: readonly QaMemoryOverviewItem[];
  /** Entries in the section, including the ones `items` does not carry. */
  readonly total: number;
}

/** One past conversation the memory store keeps. */
export interface QaMemoryOverviewSession {
  /** The chat's session id, as the deployment knows it. */
  readonly id: string;
  /** The store's summary of that conversation; empty when it wrote none. */
  readonly summary: string;
  /** When the store last touched it (ISO 8601), or `null` when it sent none. */
  readonly updatedAt: string | null;
}

/** The profile text the page shows, already bounded for the browser. */
export interface QaMemoryOverviewProfile {
  /** The file the text came from, as a display name (`identity.md`). */
  readonly name: string;
  readonly text: string;
  /** Whether the file was longer than the page shows. */
  readonly truncated: boolean;
}

/** What one account's memory looks like, as its page reads it. */
export interface QaUserMemoryOverview {
  /** Whether the memory server answered at all. */
  readonly connected: boolean;
  /** Whether this deployment is configured to keep one space per account. */
  readonly scoped: boolean;
  /**
   * Whether the memory server actually resolves this caller to the account the
   * plugin asked for. A server that ignores the identity header answers with
   * its own user — and then the space, and this page, are shared by everyone.
   */
  readonly accountApplies: boolean;
  /** The identity the memory server resolved for this caller; `""` if none. */
  readonly serverIdentity: string;
  /** What the store knows about the account, when it wrote a profile file. */
  readonly profile: QaMemoryOverviewProfile | null;
  /** The sections of the account's memory, in the store's own order. */
  readonly groups: readonly QaMemoryOverviewGroup[];
  /** The most recent past conversations, newest first. */
  readonly sessions: readonly QaMemoryOverviewSession[];
  /** Section, entry and conversation counts over everything the store holds. */
  readonly totals: {
    readonly sections: number;
    readonly memories: number;
    readonly sessions: number;
  };
  /** Why nothing could be read; present exactly when `connected` is false. */
  readonly error: string | null;
}
