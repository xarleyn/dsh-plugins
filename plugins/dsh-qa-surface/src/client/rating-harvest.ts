import type {
  QaFeedbackHarvestEntry,
  QaFeedbackHarvestResult,
  QaFeedbackRating,
} from "../types.js";
import type { RemoteResult, StorageLike } from "./types.js";

/**
 * One-shot replay of the ratings this browser still holds locally.
 *
 * A thumbs given before the surface could file it lives in the chat's ratings
 * map and nowhere else. That map carries no timestamp and no reasons, so it
 * cannot tell a lost rating from one the Host already holds a fuller version
 * of — which is why the harvest writes through an insert-only call, offers only
 * the ratings of the chats the signing-in account owns, and marks an account as
 * read rather than re-offering its verdicts on every login.
 */

/** Chat-scoped ratings keys sit under this marker: `<ns>:chat:<id>:ratings`. */
const CHAT_MARKER = ":chat:";
/** The suffix the message row writes its ratings map under. */
const RATINGS_SUFFIX = ":ratings";
/** Prefix of the per-account marker: `<ns>:ratings-harvested:<account>`. */
const HARVESTED_MARKER = ":ratings-harvested:";

/** How many ratings one request carries. */
const BATCH_SIZE = 100;

/** The durable log position an answer row's browser id carries. */
const RATED_ANSWER = /^assistant:(\d+)$/u;

/** `StorageLike` plus the enumeration a browser's `localStorage` offers. */
export interface HarvestStorage extends StorageLike {
  readonly length: number;
  key(index: number): string | null;
}

export type QaRatingHarvestStatus =
  /** This account was already read out; nothing is offered again. */
  | "already-harvested"
  /** Nothing addressable was found, so the account is marked as read. */
  | "nothing-to-harvest"
  | "harvested"
  /** A request failed; the marker stays unset and the next login retries. */
  | "failed";

export interface QaRatingHarvestReport {
  readonly status: QaRatingHarvestStatus;
  /** Ratings this browser offered for that account. */
  readonly entries: number;
  /** Ratings the Host stored. What it already held counts as nothing. */
  readonly recorded: number;
}

const ALREADY_HARVESTED: QaRatingHarvestReport = Object.freeze({
  status: "already-harvested",
  entries: 0,
  recorded: 0,
});

function harvestedKey(namespace: string, accountId: string): string {
  return `${namespace}${HARVESTED_MARKER}${accountId}`;
}

/** Whether this browser has already been read out for that account. */
export function ratingsHarvested(
  storage: HarvestStorage,
  namespace: string,
  accountId: string,
): boolean {
  try {
    return storage.getItem(harvestedKey(namespace, accountId)) === "1";
  } catch {
    // A store that will not answer has not been read out.
    return false;
  }
}

function markRatingsHarvested(
  storage: HarvestStorage,
  namespace: string,
  accountId: string,
): void {
  try {
    storage.setItem(harvestedKey(namespace, accountId), "1");
  } catch {
    // A denied write costs a replay at the next login, which the Host answers
    // as already recorded. It must not fail the harvest that just succeeded.
  }
}

function readKeys(storage: HarvestStorage): readonly string[] {
  const keys: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (typeof key === "string") keys.push(key);
    }
  } catch {
    // A store that refuses enumeration yields what it yielded until then.
  }
  return keys;
}

function parseRatings(raw: string | null): Readonly<Record<string, unknown>> {
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function ratingOf(thumbs: unknown): QaFeedbackRating | undefined {
  if (thumbs === "up") return "positive";
  return thumbs === "down" ? "negative" : undefined;
}

/**
 * Every rating this browser holds for that namespace, addressed by the
 * conversation and by the durable log position the Host files a verdict under.
 *
 * An answer row's browser id is `assistant:<position>`, so those keys are
 * addressable. Anything else — a work row, a half-streamed answer, an id the
 * Host named rather than numbered — cannot be traced back to a log position,
 * and is left where it is instead of guessed at.
 */
export function collectLocalRatings(
  storage: HarvestStorage,
  namespace: string,
): readonly QaFeedbackHarvestEntry[] {
  const prefix = `${namespace}${CHAT_MARKER}`;
  const entries: QaFeedbackHarvestEntry[] = [];
  for (const key of readKeys(storage)) {
    if (!key.startsWith(prefix) || !key.endsWith(RATINGS_SUFFIX)) continue;
    const conversationId = key.slice(prefix.length, -RATINGS_SUFFIX.length);
    if (conversationId === "") continue;
    for (const [messageId, thumbs] of Object.entries(
      parseRatings(storage.getItem(key)),
    )) {
      const position = RATED_ANSWER.exec(messageId)?.[1];
      const rating = ratingOf(thumbs);
      if (position === undefined || rating === undefined) continue;
      entries.push({ conversationId, messageId: position, rating });
    }
  }
  return entries;
}

/**
 * Read this browser's ratings out through `send`, once per account.
 *
 * `send` is the Host call; the caller chooses the token and the remote it
 * travels on. The marker is written only after every batch landed, so a
 * half-failed harvest is retried by the next login rather than lost.
 */
export async function harvestLocalRatings(options: {
  readonly storage: HarvestStorage;
  readonly namespace: string;
  readonly accountId: string;
  /** The chats the account owns; a rating of anyone else's chat is not offered. */
  readonly ownedIds: readonly string[];
  readonly send: (
    batch: readonly QaFeedbackHarvestEntry[],
  ) => Promise<RemoteResult<QaFeedbackHarvestResult>>;
}): Promise<QaRatingHarvestReport> {
  const { storage, namespace, accountId, ownedIds, send } = options;
  if (ratingsHarvested(storage, namespace, accountId)) return ALREADY_HARVESTED;
  const owned = new Set(ownedIds);
  const entries = collectLocalRatings(storage, namespace).filter((entry) =>
    owned.has(entry.conversationId),
  );
  if (entries.length === 0) {
    markRatingsHarvested(storage, namespace, accountId);
    return { status: "nothing-to-harvest", entries: 0, recorded: 0 };
  }
  let recorded = 0;
  for (let offset = 0; offset < entries.length; offset += BATCH_SIZE) {
    const result = await send(entries.slice(offset, offset + BATCH_SIZE));
    if (!result.ok) {
      return { status: "failed", entries: entries.length, recorded };
    }
    recorded += result.value.recorded;
  }
  markRatingsHarvested(storage, namespace, accountId);
  return { status: "harvested", entries: entries.length, recorded };
}
