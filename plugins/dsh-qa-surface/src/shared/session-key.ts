/**
 * The browser-local key namespace every QA-side index derives from: the
 * configured storage key pinned to the served route, versioned once so the
 * Host's head-script injection and the client bundle cannot drift apart.
 *
 * Dependency-free like every `src/shared` module: both bundles inline it.
 */

/**
 * The versioned key prefix for browser-local QA state of one deployment.
 * Callers append their own scope suffix (`:account-token`, `:welcome-notice`,
 * `:chat:<id>`, …).
 * @param config - configuration holding the storage key and the route path.
 * @returns the versioned prefix, e.g. `dsh-qa-surface.session:v1:/qa`.
 */
export function qaStorageNamespace(
  config: Readonly<{
    session: { storageKey: string };
    route: { path: string };
  }>,
): string {
  return `${config.session.storageKey}:v1:${config.route.path}`;
}
