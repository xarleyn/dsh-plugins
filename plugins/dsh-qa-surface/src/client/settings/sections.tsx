/**
 * Body sections of the QA Surface settings card.
 *
 * Each section owns its controls and derives every value from the settings
 * snapshot (the effective configuration) or, for the status view, from the
 * running Host through the `qaSurface/describe` Remote. The controls mirror
 * the Host's own validation: combinations the resolver refuses are either
 * written together in one mutation or explained rather than offered.
 *
 * One file per section lives in `sections/`, with what the config sections
 * share in `sections/common.tsx`; this module is the barrel the card imports.
 */

export type { ConfigProps } from "./sections/common.js";
export { AccessSection } from "./sections/access.js";
export { AccountsSection } from "./sections/accounts.js";
export { AttachmentsSection } from "./sections/attachments.js";
export { BrandingSection } from "./sections/branding.js";
export { EmbeddingSection } from "./sections/embedding.js";
export { InterfaceSection } from "./sections/interface.js";
export { LockdownSection } from "./sections/lockdown.js";
export { NotesSection } from "./sections/notes.js";
export { SessionSection } from "./sections/session.js";
export { SlashSection } from "./sections/slash.js";
export { SourcesSection } from "./sections/sources.js";
export { StatusSection } from "./sections/status.js";
export type { StatusProps } from "./sections/status.js";
