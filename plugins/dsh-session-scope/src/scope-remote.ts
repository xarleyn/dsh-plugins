import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";

import { listScopeDirectory, type ScopeSession } from "./host-api.js";
import type { DirectoryListing } from "./core.js";

interface ScopeSessions {
  get(id: string): ScopeSession | undefined;
}

/** Non-durable read API used by the web scope picker. */
export class SessionScopeReadService extends TypertRemoteService {
  private readonly sessions: ScopeSessions;

  constructor(ctx: Context, private readonly fallbackWorkspaceRoot = "") {
    super(ctx, "sessionScopeRead", { namespace: "sessionScope" });
    this.sessions = ctx.get("sessions") as ScopeSessions;
  }

  async list(sessionId: string, path: string): Promise<DirectoryListing> {
    const session = this.sessions.get(sessionId);
    if (session === undefined) throw new Error("Session scope is unavailable for this session.");
    return listScopeDirectory(session, path, this.fallbackWorkspaceRoot);
  }
}

function registerRemoteMethod(): void {
  const initializers: Array<(this: object) => void> = [];
  const decorate = Remote as unknown as (
    value: (...args: unknown[]) => unknown,
    context: {
      readonly name: string;
      readonly private: boolean;
      readonly static: boolean;
      addInitializer(initializer: (this: object) => void): void;
    },
  ) => void;
  decorate(
    SessionScopeReadService.prototype.list as unknown as (...args: unknown[]) => unknown,
    {
      name: "list",
      private: false,
      static: false,
      addInitializer(initializer) {
        initializers.push(initializer);
      },
    },
  );
  const markerReceiver = Object.create(SessionScopeReadService.prototype) as object;
  for (const initializer of initializers) initializer.call(markerReceiver);
}

registerRemoteMethod();
