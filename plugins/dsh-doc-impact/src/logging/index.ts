/**
 * Plugin logging bundle (future `@yadsh/dsh-plugin-log`).
 *
 * Self-contained by design: every import stays inside this folder so the
 * whole directory can be copied between plugins verbatim, or replaced by the
 * extracted package import once it exists.
 */

export * from "./dsh-home.js";
export * from "./plugin-logger.js";
