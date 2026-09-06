import type {
  SessionLogSnapshot,
  SessionQueryEngine,
  SessionRecord,
} from "@deepseek-ai/dsh-session-query";
import type { ScanRequest } from "../types.js";
import { sameWorkspace } from "../utils/workspace.js";

export interface SessionQueryLike {
  listSessions(signal?: AbortSignal): Promise<SessionRecord[]>;
  readSession(sessionId: string): Promise<SessionLogSnapshot>;
}

export class SessionSource {
  constructor(private readonly query: SessionQueryLike) {}

  async list(request: ScanRequest, signal?: AbortSignal): Promise<SessionRecord[]> {
    const all = await this.query.listSessions(signal);
    const matching = all.filter(({ header }) => {
      if (!sameWorkspace(header.cwd, request.cwd)) return false;
      if (request.from !== undefined && header.createdAt < request.from) return false;
      if (request.to !== undefined && header.createdAt > request.to) return false;
      return true;
    });
    return request.lastSessions === undefined ? matching : matching.slice(0, request.lastSessions);
  }

  read(sessionId: string): Promise<SessionLogSnapshot> {
    return this.query.readSession(sessionId);
  }
}

export function createSessionSource(query: SessionQueryEngine): SessionSource {
  return new SessionSource(query);
}
