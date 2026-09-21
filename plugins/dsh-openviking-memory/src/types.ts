/**
 * Wire types crossing the Remote boundary.
 *
 * Typert requires every type a Remote method takes or returns to be reachable
 * from a non-root subpath of the package (`./types`), because the browser
 * bundle imports the generated schemas rather than the Host implementation.
 * Keep this module dependency-free: it is loaded by the client half, which must
 * not pull `node:fs` or the Host config surface into the page.
 */

/** Which automatic context additions are in effect. */
export interface QaMemoryPlanView {
  readonly startupProfile: boolean;
  readonly stepProfile: boolean;
  readonly recall: boolean;
}

/**
 * One account's memory switches, as its settings page writes them. `null` hands
 * that knob back to the deployment; a key that is absent is left untouched.
 */
export interface QaUserMemorySettingsPatch {
  readonly autoInject?: boolean | null;
  readonly profile?: boolean | null;
  readonly recall?: boolean | null;
}

/** What the account-scoped memory page reads. */
export interface QaUserMemorySettingsView {
  /** The account's own switches; `null` means "follow the deployment". */
  readonly autoInject: boolean | null;
  readonly profile: boolean | null;
  readonly recall: boolean | null;
  /** The plan that actually applies to this account's sessions. */
  readonly effective: QaMemoryPlanView;
  /**
   * The deployment's own plan, for a page that shows what a switch narrows.
   * It is the plan the plugin configured, before any `autoInject` gating.
   */
  readonly configured: QaMemoryPlanView;
  /** Whether this deployment keeps one memory space per account. */
  readonly scoped: boolean;
}
