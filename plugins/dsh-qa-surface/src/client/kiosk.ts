/**
 * The QA kiosk presentation mode, as the client half of the plugin sees it.
 *
 * The harness publishes the deployment's UI mode into every served document
 * ahead of the first application script (the index prelude injected for
 * `DSH_UI_MODE=qa`): `window.DSH_UI_MODE` and, alongside it, the QA base path
 * the server-side route policy serves the application under. The mode — not
 * `location.pathname` — is what the client branches on: the route policy owns
 * which paths carry a document at all, and a client that keyed off the
 * pathname would re-introduce exactly the paths the policy closed.
 *
 * A document without the globals (a host without the kiosk patches, a plugin
 * bundle served into an overlay deployment) reads as the overlay
 * presentation: the `shell.overlay` registration this plugin has always
 * used. That keeps one plugin build compatible with both compositions.
 */

/** Window global the harness prelude publishes for `DSH_UI_MODE=qa`. */
const UI_MODE_GLOBAL = "DSH_UI_MODE";
/** Window global naming the QA surface's base path in kiosk mode. */
const QA_BASE_PATH_GLOBAL = "DSH_QA_BASE_PATH";
/** The QA base path when the prelude published none. */
const DEFAULT_QA_BASE_PATH = "/qa";

/**
 * Whether one URL pathname lives on a surface: the surface path itself or any
 * child of it. A plain prefix check would also match `/qadmin` or `/qa-test`.
 */
export function matchesSurface(pathname: string, surface: string): boolean {
  return pathname === surface || pathname.startsWith(`${surface}/`);
}

/**
 * Whether this browser was served by a QA kiosk deployment.
 * @param target - the global object; overridable for tests.
 */
export function qaKioskMode(
  target: Readonly<Record<string, unknown>> = window as unknown as Readonly<
    Record<string, unknown>
  >,
): boolean {
  return target[UI_MODE_GLOBAL] === "qa";
}

/**
 * The QA surface's base path of a kiosk deployment, normalized: single
 * leading slash, no trailing slash. A malformed value falls back to the
 * default rather than disabling the mode.
 * @param target - the global object; overridable for tests.
 */
export function qaKioskBasePath(
  target: Readonly<Record<string, unknown>> = window as unknown as Readonly<
    Record<string, unknown>
  >,
): string {
  const raw = target[QA_BASE_PATH_GLOBAL];
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value === "" || !value.startsWith("/") || value.endsWith("/")) {
    return DEFAULT_QA_BASE_PATH;
  }
  return value;
}
