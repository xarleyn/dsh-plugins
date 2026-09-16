/**
 * Host matching shared by the provider address policies. Both only ever need
 * the two forms below: a plain hostname, and a `*.suffix` / `.suffix` wildcard.
 */

/** `example.com` matches itself, `.corp.example` matches its subdomains. */
export function hostMatchesSuffix(hostname: string, suffix: string): boolean {
  return hostname.endsWith(suffix) && hostname.length > suffix.length;
}

/** `example.com` matches itself, `*.corp.example` matches its subdomains. */
export function hostMatchesPattern(hostname: string, pattern: string): boolean {
  if (!pattern.startsWith("*.")) return hostname === pattern;
  return hostMatchesSuffix(hostname, pattern.slice(1));
}
