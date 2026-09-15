import type { QaPrincipal } from "./types.js";

/** Runtime-only proof that a QA root session was attested by its own user. */
export class QaIntegrationPrincipalBindings {
  private readonly principals = new Map<string, string>();

  attest(
    sessionId: string,
    actorUserId: string | undefined,
    ownerUserId: string | undefined,
  ): void {
    if (actorUserId !== undefined && actorUserId === ownerUserId) {
      this.principals.set(sessionId, actorUserId);
    } else {
      this.principals.delete(sessionId);
    }
  }

  resolve(
    sessionId: string,
    currentOwnerUserId: string | undefined,
  ): QaPrincipal | undefined {
    const userId = this.principals.get(sessionId);
    return userId !== undefined && userId === currentOwnerUserId
      ? { userId }
      : undefined;
  }

  clear(): void {
    this.principals.clear();
  }
}
