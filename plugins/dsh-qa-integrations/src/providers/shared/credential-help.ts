import z from "@deepseek-ai/schemastery";
import type { CredentialHelpOverride } from "@yadsh/dsh-plugin-kit";

/**
 * Deployment replacement of one provider's credential help, as it appears under
 * `credentialHelp.<provider>` in YAML. Every field is optional and replaces only
 * itself: an internal gateway rewrites the obtain address, a corporate wiki
 * replaces the documentation link, and a deployment that hides the help says
 * `enabled: false`.
 *
 * The credential mechanism (`kind`) is the integration's own statement, so an
 * override rarely names it; a value that is not a known mechanism degrades to
 * `custom` with a startup warning rather than failing the provider.
 */
export const credentialHelpOverrideSchema = z.object({
  enabled: z.boolean(),
  kind: z.string(),
  label: z.string(),
  obtainUrl: z.string(),
  obtainLabel: z.string(),
  docsUrl: z.string(),
  docsLabel: z.string(),
  instructions: z.string(),
  instructionsLocaleKey: z.string(),
  scopes: z.array(z.string()),
  notes: z.array(z.string()),
  selfHosted: z.boolean(),
}) as unknown as z<CredentialHelpOverride>;

/** The overrides of every provider, keyed by provider id. */
export const credentialHelpOverridesSchema: z<
  Record<string, CredentialHelpOverride>
> = z.dict(credentialHelpOverrideSchema) as unknown as z<
  Record<string, CredentialHelpOverride>
>;
