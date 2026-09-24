import { describe, expect, it } from "vitest";
import { QA_SURFACE_STYLES } from "../../../src/client/styles.js";
import {
  QA_BLEED_MAX_WIDTH,
  QA_CONTENT_EDGE_BUDGET,
  QA_HANDLE_FREE_BAND,
} from "../../../src/client/components/QaWidthHandle.js";

/** Body of the first rule matching a selector, as written in the sheet. */
function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector}{`);
  expect(start, `${selector} is missing from the sheet`).toBeGreaterThan(-1);
  return css.slice(start + selector.length + 1, css.indexOf("}", start));
}

describe("QA transcript layout contract", () => {
  // The two numbers live apart: the ceiling in the component, the free band
  // described by the handle's inset plus the transcript's side padding. Tying
  // them here is what keeps a bled block from sliding under the drag target.
  it("keeps the assistant bleed inside the handle's free band", () => {
    expect(QA_BLEED_MAX_WIDTH).toBeLessThan(QA_HANDLE_FREE_BAND);
    expect(QA_HANDLE_FREE_BAND).toBeLessThan(QA_CONTENT_EDGE_BUDGET / 2);
  });

  it("caps the bleed by the live side gutter, never by the viewport", () => {
    const inner = ruleBody(QA_SURFACE_STYLES, ".dsh-qa-transcript__inner");
    expect(inner).toContain("--dsh-qa-column-width");
    expect(inner).toContain(`--dsh-qa-bleed:min(${QA_BLEED_MAX_WIDTH}px`);

    // A viewport-derived gutter ignored the sidebars and panels inside the
    // surface, so bled blocks reached past both the column and the handles.
    // The block that bleeds is the whole fenced-code card (its banner carries
    // the same width as its code), never a bare `pre` inside it.
    const block = ruleBody(
      QA_SURFACE_STYLES,
      ".dsh-qa-message--assistant .dsh-qa-message__content .dsh-qa-md-code",
    );
    expect(block).toContain("var(--dsh-qa-bleed)");
    expect(block).not.toContain("vw");
    expect(QA_SURFACE_STYLES).not.toContain(
      ".dsh-qa-message--assistant .dsh-qa-message__content pre{",
    );
  });

  it("bounds tables instead of stretching or spilling them", () => {
    const wrapper = ruleBody(QA_SURFACE_STYLES, ".dsh-qa-md-table");
    expect(wrapper).toContain("max-width:100%");
    expect(wrapper).toContain("overflow-x:auto");

    // Natural width, never the column's width: filling a wide column is what
    // dumped the slack into the first column and blew the table up.
    const table = ruleBody(QA_SURFACE_STYLES, ".dsh-qa-md-table table");
    expect(table).toContain("width:max-content");

    const cells = ruleBody(
      QA_SURFACE_STYLES,
      ".dsh-qa-md-table th,.dsh-qa-md-table td",
    );
    expect(cells).toContain("var(--dsh-qa-content-width");
    expect(cells).toContain("max-width:max(");
    expect(cells).toContain("overflow-wrap:anywhere");
    // Tables stay in the text column: the handle lane is not theirs to take.
    expect(cells).not.toContain("--dsh-qa-bleed");
  });

  it("drops the bleed on the phone layout, where the handles are hidden", () => {
    // The onboarding panel owns its own 600px query earlier in the sheet, so
    // read the transcript layout from the last one.
    const mobile = QA_SURFACE_STYLES.slice(
      QA_SURFACE_STYLES.lastIndexOf("@media (max-width:600px)"),
    );
    expect(ruleBody(mobile, ".dsh-qa-transcript__inner")).toContain(
      "--dsh-qa-bleed:0px",
    );
  });
});
