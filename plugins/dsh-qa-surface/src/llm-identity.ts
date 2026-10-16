import { createHash } from "node:crypto";
import { Service, type Context } from "@deepseek-ai/cordis";
import type { QaAccounts } from "./accounts/store.js";

interface IdentityAccounts {
  ownerIdOf: QaAccounts["ownerIdOf"];
  accountById: QaAccounts["accountById"];
}

export interface QaLlmIdentityOptions {
  /** Resolves only roots attested by this QA deployment and their live children. */
  rootOf(sessionId: string): string | undefined;
  accounts(): IdentityAccounts | undefined;
}

/** Runtime-only identity seam; it grants no account or tool access. */
export class QaLlmIdentity extends Service {
  constructor(
    ctx: Context,
    private readonly options: QaLlmIdentityOptions,
  ) {
    super(ctx, "qaLlmIdentity");
  }

  /** Stable pseudonym of the chat's active owner, never the browser viewing it. */
  forSession(sessionId: string): string | undefined {
    const root = this.options.rootOf(sessionId);
    if (root === undefined || this.options.rootOf(root) !== root)
      return undefined;
    const accounts = this.options.accounts();
    const ownerId = accounts?.ownerIdOf(root);
    if (ownerId === undefined || accounts?.accountById(ownerId) === undefined)
      return undefined;
    // Account IDs are server-generated random UUIDs, not user-chosen names.
    return (
      "qa_u_" +
      createHash("sha256")
        .update("dsh-qa-llm-user:v1\0")
        .update(ownerId)
        .digest("hex")
    );
  }
}
