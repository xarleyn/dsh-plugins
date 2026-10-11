/**
 * The browser session runtime the host service drives.
 *
 * The implementation is a module directory, not a file: `session/` separates
 * the browser's lifecycle, the registry of pages a session has open, the queue
 * an action travels on, and the policy refusals the operator is shown. This is
 * the public door of that directory and holds nothing itself.
 */
export * from "./session/index.js";
