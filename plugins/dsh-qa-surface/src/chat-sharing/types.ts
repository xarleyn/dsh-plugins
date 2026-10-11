export type QaChatMode = "read" | "collaborate";
export interface QaChatAccess {
  readonly sessionId: string;
  readonly ownerId: string;
  readonly ownerName: string;
  readonly actorId: string;
  readonly mode: QaChatMode | "owner";
  readonly revision: number;
}
export interface QaChatGrant {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly mode: QaChatMode;
}
export interface QaChatAuthor {
  readonly requestId: string;
  readonly userId: string;
  readonly displayName: string;
}
/** JSON-shaped native frames; the local recursive codec owns the wire schema. */
export type QaChatJson =
  | null
  | string
  | number
  | boolean
  | readonly QaChatJson[]
  | { readonly [key: string]: QaChatJson };
