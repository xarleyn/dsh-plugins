/** Stop waiting for a credential when the call is cancelled. The credential
 * service owns its lookup and can settle it after the caller has left. */
export async function resolveApiKeyWithSignal(
  resolve: () => Promise<string | undefined>,
  signal: AbortSignal,
): Promise<string | undefined> {
  signal.throwIfAborted();
  let onAbort!: () => void;
  const stopped = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([resolve(), stopped]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
