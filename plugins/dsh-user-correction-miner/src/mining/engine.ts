import type { Session, SessionEvent } from "@deepseek-ai/dsh-session";
import type { SessionLogSnapshot, SessionRecord } from "@deepseek-ai/dsh-session-query";
import type { ResolvedUserCorrectionMinerConfig } from "../config.js";
import type {
  CorrectionEvidence,
  CorrectionRecord,
  CorrectionStore,
  ScanCursor,
  ScanReport,
  ScanRequest,
} from "../types.js";
import { correctionRecordId, sha256 } from "../utils/hashing.js";
import { workspaceKey } from "../utils/workspace.js";
import { isDirectUserMessage, messageText } from "./message-text.js";
import { prefilterCorrection } from "./prefilter.js";
import { boundText, redactSecrets } from "./sanitize.js";
import { scanSession, type SessionSnapshot } from "./scanner.js";

export interface SessionSourceLike {
  list(request: ScanRequest, signal?: AbortSignal): Promise<SessionRecord[]>;
  read(sessionId: string): Promise<SessionLogSnapshot>;
}

export interface MinerLogger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

interface PendingSession {
  readonly eventSeqs: Set<number>;
  lastEventAt: number;
}

function emptyCursor(key: string): ScanCursor {
  return { workspaceKey: key, sessionWatermarks: {}, updatedAt: 0 };
}

export class CorrectionMinerEngine {
  private readonly pending = new Map<string, PendingSession>();
  private readonly workspaceQueues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly source: SessionSourceLike,
    private readonly store: CorrectionStore,
    private readonly config: ResolvedUserCorrectionMinerConfig,
    private readonly logger: MinerLogger,
    private readonly now: () => number = Date.now,
  ) {}

  scan(request: ScanRequest, signal?: AbortSignal): Promise<ScanReport> {
    const key = workspaceKey(request.cwd);
    return this.enqueue(key, () => this.runHistoricalScan(request, signal));
  }

  observeEvent(session: Session, event: SessionEvent): void {
    if (!this.config.enabled) return;
    const observedAt = this.now();
    this.evictExpired(observedAt);
    const sessionId = String(session.id);
    const current = this.pending.get(sessionId);
    if (current !== undefined) current.lastEventAt = observedAt;
    if (event.type === "user/message" && isDirectUserMessage(event.data)) {
      const result = prefilterCorrection(messageText(event.data));
      if (result.matched) {
        const pending = current ?? this.createPendingSession(sessionId, observedAt);
        pending.eventSeqs.add(event.seq);
        while (pending.eventSeqs.size > this.config.live.maxPendingEventsPerSession) {
          const oldestEventSeq = pending.eventSeqs.values().next().value as number;
          pending.eventSeqs.delete(oldestEventSeq);
          this.warnPendingEviction("event-cap", sessionId, 1);
        }
      }
      return;
    }
    if (event.type === "turn/end") this.scheduleLiveSession(session);
  }

  observeDisposed(session: Session): void {
    if (!this.config.enabled) return;
    this.evictExpired(this.now());
    this.scheduleLiveSession(session);
  }

  dispose(): void {
    this.pending.clear();
  }

  count(cwd: string): number {
    return this.store.countCorrections(workspaceKey(cwd));
  }

  list(cwd: string, limit = 50): readonly CorrectionRecord[] {
    return this.store.listCorrections(workspaceKey(cwd), limit);
  }

  private scheduleLiveSession(session: Session): void {
    const sessionId = String(session.id);
    if ((this.pending.get(sessionId)?.eventSeqs.size ?? 0) === 0) return;
    this.pending.delete(sessionId);
    const cwd = session.header.cwd;
    if (cwd === undefined) return;
    const snapshot: SessionSnapshot = {
      session: session.header,
      events: session.events,
    };
    const key = workspaceKey(cwd);
    void this.enqueue(key, () => this.runSnapshot(snapshot, key, true)).catch((error: unknown) => {
      this.logger.warn("incremental_scan.failed", {
        sessionId,
        reason: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private async runHistoricalScan(request: ScanRequest, signal?: AbortSignal): Promise<ScanReport> {
    const key = workspaceKey(request.cwd);
    const sessions = await this.source.list(request, signal);
    let sessionsScanned = 0;
    let sessionsFailed = 0;
    let eventsScanned = 0;
    let correctionsFound = 0;
    let correctionsAdded = 0;

    for (const record of sessions) {
      if (signal?.aborted === true) throw signal.reason;
      try {
        const snapshot = await this.source.read(String(record.header.id));
        const report = await this.runSnapshot(snapshot, key, request.incremental !== false);
        sessionsScanned += 1;
        eventsScanned += report.eventsScanned;
        correctionsFound += report.correctionsFound;
        correctionsAdded += report.correctionsAdded;
      } catch (error) {
        sessionsFailed += 1;
        this.logger.warn("historical_scan.session_failed", {
          sessionId: String(record.header.id),
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const report = {
      workspaceKey: key,
      sessionsConsidered: sessions.length,
      sessionsScanned,
      sessionsFailed,
      eventsScanned,
      correctionsFound,
      correctionsAdded,
    };
    this.logger.info("historical_scan.completed", report);
    return report;
  }

  private async runSnapshot(
    snapshot: SessionSnapshot,
    key: string,
    incremental: boolean,
  ): Promise<{ eventsScanned: number; correctionsFound: number; correctionsAdded: number }> {
    const cursor = this.store.getCursor(key) ?? emptyCursor(key);
    const sessionId = String(snapshot.session.id);
    const afterSeq = incremental ? (cursor.sessionWatermarks[sessionId] ?? -1) : -1;
    const result = scanSession(snapshot, afterSeq, this.config.analysis);
    let correctionsAdded = 0;
    for (const evidence of result.evidence) {
      const record = this.toRecord(evidence, key);
      const existed = this.store.hasCorrection(record.id);
      await this.store.putCorrection(record, this.config.retention.maxRecordsPerWorkspace);
      if (!existed) correctionsAdded += 1;
    }
    const capturedThroughSeq = result.capturedThroughSeq;
    const nextCursor: ScanCursor = {
      workspaceKey: key,
      lastAnalyzedSession: sessionId,
      ...(capturedThroughSeq === null ? {} : { lastAnalyzedEventSeq: capturedThroughSeq }),
      sessionWatermarks: {
        ...cursor.sessionWatermarks,
        ...(capturedThroughSeq === null
          ? {}
          : { [sessionId]: Math.max(afterSeq, capturedThroughSeq) }),
      },
      updatedAt: Date.now(),
    };
    await this.store.putCursor(nextCursor);
    return {
      eventsScanned: result.eventsScanned,
      correctionsFound: result.evidence.length,
      correctionsAdded,
    };
  }

  private toRecord(evidence: CorrectionEvidence, key: string): CorrectionRecord {
    const sanitize = (text: string): string => {
      const redacted = this.config.privacy.redactSecrets ? redactSecrets(text) : text;
      return this.config.privacy.persistRawMessages
        ? redacted
        : boundText(redacted, this.config.privacy.maxStoredTextChars);
    };
    return {
      id: correctionRecordId(evidence.sessionId, evidence.userEventSeq),
      sessionId: evidence.sessionId,
      eventSeq: evidence.userEventSeq,
      workspaceKey: key,
      cwd: evidence.cwd,
      text: sanitize(evidence.userText),
      textDigest: sha256(evidence.userText),
      contextDigest: evidence.contextDigest,
      contextEvents: evidence.contextEvents.map((event) => ({ ...event, text: sanitize(event.text) })),
      ...(evidence.previousUserEvent === undefined
        ? {}
        : { previousUserEvent: evidence.previousUserEvent }),
      previousAssistantEvents: [...evidence.previousAssistantEvents],
      previousToolEvents: [...evidence.previousToolEvents],
      matchedSignals: [...evidence.matchedSignals],
      likelyOneOff: evidence.likelyOneOff,
      createdAt: evidence.timestamp,
    };
  }

  private enqueue<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.workspaceQueues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    this.workspaceQueues.set(key, next);
    void next.finally(() => {
      if (this.workspaceQueues.get(key) === next) this.workspaceQueues.delete(key);
    }).catch(() => undefined);
    return next;
  }

  private createPendingSession(sessionId: string, observedAt: number): PendingSession {
    while (this.pending.size >= this.config.live.maxPendingSessions) {
      let oldestSessionId: string | undefined;
      let oldestObservedAt = Number.POSITIVE_INFINITY;
      for (const [candidateId, candidate] of this.pending) {
        if (candidate.lastEventAt < oldestObservedAt) {
          oldestSessionId = candidateId;
          oldestObservedAt = candidate.lastEventAt;
        }
      }
      if (oldestSessionId === undefined) break;
      const evicted = this.pending.get(oldestSessionId);
      this.pending.delete(oldestSessionId);
      this.warnPendingEviction("session-cap", oldestSessionId, evicted?.eventSeqs.size ?? 0);
    }
    const pending = { eventSeqs: new Set<number>(), lastEventAt: observedAt };
    this.pending.set(sessionId, pending);
    return pending;
  }

  private evictExpired(observedAt: number): void {
    for (const [sessionId, pending] of this.pending) {
      if (observedAt - pending.lastEventAt < this.config.live.pendingTtlMs) continue;
      this.pending.delete(sessionId);
      this.warnPendingEviction("ttl", sessionId, pending.eventSeqs.size);
    }
  }

  private warnPendingEviction(
    reason: "event-cap" | "session-cap" | "ttl",
    sessionId: string,
    evictedEvents: number,
  ): void {
    this.logger.warn("pending.evicted", {
      reason,
      sessionId,
      evictedEvents,
      pendingSessions: this.pending.size,
    });
  }
}
