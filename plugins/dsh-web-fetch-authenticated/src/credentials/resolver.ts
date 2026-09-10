/**
 * Credential resolution over the DSH credential seam (`ctx.credentials`,
 * SPEC §12). Resolution happens per request and is never cached; a missing or
 * malformed reference is a structured failure, never a silent empty header.
 * @module credentials/resolver
 */

import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'

/** The plugin-side seam: values in, nothing out. */
export interface CredentialResolver {
  /** Resolve one reference to its current value, or `undefined` while unconfigured. */
  resolve(ref: string): Promise<string | undefined>
  /** Cheap presence/writability facts safe for configuration UIs. */
  describe(ref: string): Promise<{ configured: boolean; writable: boolean } | undefined>
}

/** Structural view the provider passes in; `undefined` when no credentials service is mounted. */
export type CredentialsServiceLike = Pick<CredentialProvider, 'resolve' | 'describe'> | undefined

/** Build the plugin resolver over the Host's credential provider. */
export function createCredentialResolver(credentials: CredentialsServiceLike): CredentialResolver {
  return {
    async resolve(ref: string): Promise<string | undefined> {
      if (credentials === undefined || !isCredentialRefName(ref)) return undefined
      const resolved = await credentials.resolve(credentialRef(ref))
      // An empty stored value is "absent" everywhere in the seam; keep the
      // plugin's contract identical so a blank never becomes an empty header.
      const value = resolved?.value
      return value !== undefined && value.length > 0 ? value : undefined
    },
    async describe(ref: string) {
      if (credentials === undefined || !isCredentialRefName(ref)) return undefined
      const info = await credentials.describe(credentialRef(ref))
      return info === undefined ? undefined : { configured: info.configured, writable: info.writable }
    },
  }
}
