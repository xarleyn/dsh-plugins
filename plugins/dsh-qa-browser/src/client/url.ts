/**
 * What a person typed in the panel's address field, turned into something the
 * Host's network policy can judge. The panel does not second-guess the policy:
 * it only decides what a bare host means, which the browser itself does by
 * assuming the scheme a person would have typed.
 */

const SCHEME = /^([a-z][a-z0-9+.-]*):(.*)$/iu;

/** A `host:port` pair, where the colon is a port and never a scheme name. */
const PORT_ONLY = /^\d+(?:[/?#]|$)/u;

/**
 * Normalize an address from the panel's field.
 *
 * Returns `null` when there is nothing to navigate to. Anything that already
 * carries a scheme is passed through — including the ones the policy will
 * refuse, since the refusal belongs to the Host and reads better than a silent
 * rewrite here.
 */
export function normalizeAddress(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  const scheme = SCHEME.exec(trimmed);
  if (scheme !== null && !PORT_ONLY.test(scheme[2] ?? "")) return trimmed;
  return `https://${trimmed}`;
}

/**
 * The host part of an address, for a tab that has no title yet. `about:blank`
 * and other scheme-only addresses have no host, which is what the caller needs
 * to fall back to its own wording.
 */
export function addressHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.host === "" ? null : parsed.host;
  } catch {
    return null;
  }
}

/** The compact label a tab shows before its title arrives. */
export function addressLabel(url: string): string {
  return addressHost(url) ?? url;
}

/**
 * The name a tab carries: its title once the page has one, the host while it
 * does not, and the wording a browser uses for a tab that is still blank.
 */
export function pageLabel(title: string, url: string): string {
  const trimmed = title.trim();
  if (trimmed !== "") return trimmed;
  if (url === "" || url === "about:blank") return "Новая вкладка";
  return addressLabel(url);
}
