/**
 * Canonical home of the card shell contract:
 * `@yadsh/dsh-plugin-scripts/verify-plugin-card-contract`.
 *
 * This root module stays as a thin re-export so plugins that still import the
 * repository path (`../../../scripts/verify-plugin-card-contract.mjs`) keep
 * resolving the same assertions. New plugins should import the package
 * subpath instead.
 */
export {
  CANONICAL_SHELL_RULES,
  verifyPluginCardContract,
} from "@yadsh/dsh-plugin-scripts/verify-plugin-card-contract";
