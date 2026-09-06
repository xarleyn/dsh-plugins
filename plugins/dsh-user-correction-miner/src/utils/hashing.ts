import { createHash } from "node:crypto";

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function correctionRecordId(sessionId: string, eventSeq: number): string {
  return sha256(`${sessionId}\0${eventSeq}`);
}
