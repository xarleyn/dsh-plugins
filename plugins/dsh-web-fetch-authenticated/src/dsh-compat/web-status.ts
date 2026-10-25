/**
 * Compatibility helpers for non-public DSH surfaces (SPEC §27). Everything
 * version-sensitive is quarantined here; INVESTIGATE.md §8 documents each
 * point. If a future DSH exposes a public accessor, only this file changes.
 * @module dsh-compat/web-status
 */

/** The runtime shapes a structural read may encounter, newest first. */
interface WebRuntimeStructuralShape {
  /**
   * Since DSH `0.2.1`: `WebRuntime` holds its config as a constructor-captured
   * own property, and the pinned fetch-provider id is a volatile field read
   * through `.get()` at each operation.
   */
  config?: {
    fetchProvider?: { get?: () => unknown };
  };
  /** The `DSH_WEB_FETCH_PROVIDER` fallback the runtime resolves after config. */
  fetchProviderEnv?: unknown;
  /** Before DSH `0.2.1`: the resolved id lived directly in a private field. */
  fetchProviderId?: unknown;
}

function asConfiguredId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Best-effort observation of the `ctx.web` fetch-provider selection.
 * `WebRuntime` publishes no accessor. Since DSH `0.2.1` the pinned id lives in
 * a volatile config field (`config.fetchProvider.get()`), resolved against the
 * `DSH_WEB_FETCH_PROVIDER` environment value in the same precedence the Host
 * uses; earlier releases kept the resolved id in a private `fetchProviderId`
 * field. This reads the shapes structurally, newest first, and reports
 * `undefined` on any mismatch — diagnostic only; behavior never depends on it.
 */
export function observedFetchProviderId(web: unknown): string | undefined {
  if (web === undefined || web === null || typeof web !== "object") {
    return undefined;
  }
  const shape = web as WebRuntimeStructuralShape;
  const fromConfig = asConfiguredId(shape.config?.fetchProvider?.get?.());
  if (fromConfig !== undefined) return fromConfig;
  const fromEnv = asConfiguredId(shape.fetchProviderEnv);
  if (fromEnv !== undefined) return fromEnv;
  return asConfiguredId(shape.fetchProviderId);
}
