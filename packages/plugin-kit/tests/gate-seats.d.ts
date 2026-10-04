/**
 * Types for the shared card-contract gate. It ships as plain `.mjs`, so the
 * subpath export resolves untyped; the declaration gives the import a shape and
 * nothing more — the lists themselves come from the module the package gate of
 * this very package reads the built bundle against.
 */
declare module "@yadsh/dsh-plugin-scripts/verify-plugin-card-contract" {
  export const HOST_CHROME_SEATS: readonly string[];
  export const OWN_SHELL_SEATS: readonly string[];
}
