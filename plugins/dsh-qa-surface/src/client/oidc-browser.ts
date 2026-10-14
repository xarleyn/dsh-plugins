import type { QaOidcStart, ResolvedQaSurfaceConfig } from "../types.js";
import { qaStorageNamespace } from "../shared/session-key.js";

export interface QaOidcBrowser {
  begin(start: QaOidcStart): void;
  takeHandoff(): { handoff: string; completionKey: string } | null;
  logout(url: string): void;
}

/** Completion proof is isolated to the initiating tab and never goes in a URL. */
export function createQaOidcBrowser(
  browser: Pick<Window, "location" | "history" | "sessionStorage">,
  config: () => ResolvedQaSurfaceConfig,
): QaOidcBrowser {
  const key = () => `${qaStorageNamespace(config())}:oidc-completion`;
  return {
    begin(start) {
      const destination = new URL(start.authorizationUrl);
      if (destination.protocol !== "https:")
        throw new Error("Invalid sign-in destination");
      browser.sessionStorage.setItem(key(), start.completionKey);
      browser.location.assign(destination.href);
    },
    takeHandoff() {
      const fragment = new URLSearchParams(browser.location.hash.slice(1));
      const handoff = fragment.get("qa-oidc");
      if (handoff === null) return null;
      const url = new URL(browser.location.href);
      url.hash = "";
      browser.history.replaceState(browser.history.state, "", url.href);
      let completionKey: string | null = null;
      try {
        completionKey = browser.sessionStorage.getItem(key());
        browser.sessionStorage.removeItem(key());
      } catch {
        // Restricted storage refuses completion through the normal login gate.
      }
      return { handoff, completionKey: completionKey ?? "" };
    },
    logout(url) {
      const destination = new URL(url);
      if (destination.protocol !== "https:")
        throw new Error("Invalid logout destination");
      browser.location.assign(destination.href);
    },
  };
}
