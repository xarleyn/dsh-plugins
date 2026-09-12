import type { QaCreateSession } from "./types.js";

/** The wire failure's code plus its message — preset composition reasons (a
 * broken loader entry, a missing tool) ride the message and never anywhere
 * else, so collapsing to the code costs the operator the whole diagnosis. */
function wireFailure(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  return message === "" ? code : `${code}: ${message}`;
}

/**
 * Ask the QA Host boundary to create a fully composed session. The browser
 * supplies only its account token and cannot select cwd, workspace, owner,
 * preset, model, or permission policy. The resulting session
 * is addressed only here — no prompt can run before the caller attests the
 * composed preset.
 */
export async function createQaSession(args: {
  readonly createSession: QaCreateSession;
  readonly token: string;
}): Promise<string> {
  const created = await args.createSession(args.token);
  if (!created.ok) throw new Error(wireFailure(created.error));
  return created.value;
}
