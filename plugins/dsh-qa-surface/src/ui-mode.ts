/**
 * The deployment UI mode, as the host half of the plugin sees it.
 *
 * `DSH_UI_MODE=qa` (the kiosk) moves the frontend URL-space ownership from
 * this plugin to the harness: the harness route policy serves `/qa` directly,
 * redirects `/` into it, and answers every other frontend path with 404. The
 * plugin's own navigation redirect route must then stay unregistered — it
 * exists for the overlay composition, where the index is served at `/` and a
 * browser navigation to `/qa` has to bounce through the marker hand-off —
 * because a registered route shadows the harness fallback seat and would
 * loop every `/qa` navigation back onto itself.
 */

/** Environment variable selecting the deployment UI mode (`qa` = kiosk). */
const UI_MODE_ENV = "DSH_UI_MODE";

/**
 * Whether this harness process runs the QA kiosk UI mode.
 * @param env - the process environment; overridable for tests.
 */
export function qaKioskDeployment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return (env[UI_MODE_ENV] ?? "").trim() === "qa";
}
