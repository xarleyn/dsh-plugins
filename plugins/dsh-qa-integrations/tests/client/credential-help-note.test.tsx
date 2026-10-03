// @vitest-environment jsdom

/**
 * The local copy of the credential-help note against the kit's original.
 *
 * `src/client/credential-help-note.tsx` repeats the kit's markup because the kit's
 * trigger draws the card shell's chevron and a panel-seated bundle may not carry
 * that path (the reason is on that file). The copy has no owner on the kit's side
 * yet, so the drift is pinned here instead: both notes render the same metadata and
 * their content — text, element order, link targets — must stay equal, while their
 * class names must stay apart, or the two sheets start fighting over one selector.
 */

import { fireEvent, render } from "@testing-library/react";
import type { CredentialHelp } from "@yadsh/dsh-plugin-kit";
import { CredentialHelpNote as KitNote } from "@yadsh/dsh-plugin-kit/client";
import { describe, expect, it } from "vitest";
import { CredentialHelpNote as LocalNote } from "../../src/client/credential-help-note.js";

const HELP: CredentialHelp = Object.freeze({
  kind: "personal-access-token",
  label: "GitLab personal access token",
  obtain: {
    url: "https://gitlab.example/-/user_settings/personal_access_tokens",
  },
  docs: { url: "https://docs.gitlab.example/tokens" },
  instructions: "Open the token page.\nGrant read_api only.",
  scopes: ["read_api", "read_user"],
  notes: ["The token never leaves this browser."],
});

/** Only a link, so the note has nothing to expand. */
const LINK_ONLY: CredentialHelp = Object.freeze({
  kind: "oauth",
  docs: { url: "https://docs.example/oauth" },
});

/**
 * What a rendered note says, with the two differences this pair is allowed to have
 * removed: the class names (the copy dresses its own block) and the disclosure glyph
 * (the kit's is the card shell's inline chevron, which this bundle may not carry).
 * The `useId` values differ between two mounts, so they go too.
 */
function content(html: string): string {
  return html
    .replace(/<svg[\s\S]*?<\/svg>/gu, "")
    .replace(/<span[^>]*__chevron[^>]*><\/span>/gu, "")
    .replace(/\s(?:class|id|aria-controls)="[^"]*"/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function rendered(Note: typeof KitNote, help: CredentialHelp): string {
  const { container } = render(<Note help={help} />);
  const trigger = container.querySelector("button");
  if (trigger !== null) fireEvent.click(trigger);
  return container.innerHTML;
}

describe("the credential-help note this bundle renders", () => {
  it("says what the kit's note says, in the same order", () => {
    expect(content(rendered(LocalNote, HELP))).toEqual(
      content(rendered(KitNote, HELP)),
    );
  });

  it("keeps the single-link form equal too", () => {
    expect(content(rendered(LocalNote, LINK_ONLY))).toEqual(
      content(rendered(KitNote, LINK_ONLY)),
    );
  });

  it("stays off the kit's selectors", () => {
    // Two sheets carrying the same selectors at the same specificity settle which
    // ring and which glyph win by <style> order alone, and no gate sees that. The
    // built artifact is pinned the same way by scripts/verify-package.mjs.
    expect(rendered(LocalNote, HELP)).not.toContain("dsh-credential-help");
  });

  it("carries no card-shell chevron path", () => {
    // The shared note's glyph is the shell's; a bundle seated on the panel may not
    // ship that path anywhere in itself.
    expect(rendered(LocalNote, HELP)).not.toMatch(/m3\.5 5\.25/u);
  });
});
