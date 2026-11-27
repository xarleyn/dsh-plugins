import { ENDPOINT_ID } from "../kernel/address.js";

export const DIRECTUS_PROVIDER_PREFIX = "directus:";

export function directusProviderId(instance: string): string {
  return DIRECTUS_PROVIDER_PREFIX + instance;
}

export function isDirectusProviderId(provider: string): boolean {
  return (
    provider.startsWith(DIRECTUS_PROVIDER_PREFIX) &&
    ENDPOINT_ID.test(provider.slice(DIRECTUS_PROVIDER_PREFIX.length))
  );
}
