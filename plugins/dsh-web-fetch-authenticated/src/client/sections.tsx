/**
 * Sections of the Authenticated Web Fetch settings card (SPEC §6). All state
 * shown here is sanitized by construction: no component ever receives a
 * credential value — the credential control stages a write-only input and
 * asks the credentials domain only for configured/writable facts.
 *
 * One file per section lives in `sections/`, with the shared controls and the
 * client face in `sections/common.tsx`; this module is the barrel the card
 * imports.
 */

export type { CardFace, CredentialsRemote } from "./sections/common.js";
export { StatusSection } from "./sections/status.js";
export { GlobalSection } from "./sections/global.js";
export { RulesSection } from "./sections/rules.js";
export { DiagnosticsSection } from "./sections/diagnostics.js";
