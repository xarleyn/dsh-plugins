/**
 * Client kit for DSH plugin settings cards: the canonical card shell (CSS +
 * components) and the shared bootstrap helpers used by plugin browser
 * bundles. This subpath is consumed by plugin client sources and must stay
 * self-contained after each plugin's tsdown build inlines it.
 */
export { PLUGIN_CARD_SHELL_CSS } from "./plugin-card-css.js";
export { ChevronDown } from "./chevron.js";
export { CardShell, type CardShellProps } from "./card-shell.js";
export {
  SETTINGS_PLUGIN_ITEM_SLOT,
  injectCardStyles,
  registerSettingsCard,
  registerSettingsSlot,
  type SettingsCardHost,
  type SettingsCardOptions,
  type SettingsCardSlotOptions,
  type SettingsCardSlots,
} from "./register-settings-card.js";
export { bindSettingsExternalStore } from "./settings-store.js";
export {
  startVisibilityAwarePolling,
  type PollingWindow,
  type VisibilityDocument,
} from "./polling.js";
