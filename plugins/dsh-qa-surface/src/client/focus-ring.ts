import type { KeyboardEvent } from "react";

/**
 * The tags and states a browser may give a place on the Tab path. What the page
 * has since taken away is read by `focusable`, one condition per function below.
 *
 * The tags are those the surface paints: a `select` is the role picker of the
 * chat header and a `summary` the fold of a message, both inside `<main>`, so an
 * enumeration that skipped one of them drew the edge of the ring past a control
 * the reader still reaches. `[tabindex]` is what catches anything else the
 * markup chose to make reachable.
 */
const TABABLE_SELECTOR =
  "button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], summary, [tabindex]";

/**
 * Whether `tabindex` takes this element off the Tab path.
 *
 * The negative value has to be read off every branch of the selector, not just
 * off the `[tabindex]` one: what makes the composer's attachment picker
 * unreachable by Tab is the `-1` it carries, and the browser never asks that the
 * element is not also an `input`. The content attribute is what is consulted,
 * because that is what the markup writes and the one thing a browser and jsdom
 * agree on; a value neither can parse leaves the element on the path.
 */
function isTabbedOut(element: HTMLElement): boolean {
  const value = element.getAttribute("tabindex");
  if (value === null) return false;
  return Number.parseInt(value, 10) < 0;
}

/**
 * Whether the page has taken this element out of the layout: `hidden` stands on
 * it or on one of its ancestors, and a browser reads that as a control with no
 * place on the Tab path.
 *
 * The ancestor chain matters for the same reason `inert` does: a panel body the
 * surface keeps mounted and hides instead of unmounting leaves its buttons in
 * `root`, and an edge of the ring aimed at one of them is a key the surface
 * prevents and can hand no focus to.
 */
function isHidden(element: HTMLElement): boolean {
  return element.closest("[hidden]") !== null;
}

/**
 * Whether a modal gate has taken this element away from the keyboard: the
 * element itself or an ancestor of it is marked inert.
 *
 * `inert` is read as a property, not looked up as an attribute. The gate marks
 * the page inert from script (`QaWelcomeNotice`), a browser reflects that into
 * the attribute, and jsdom stores nothing but the property on the element it
 * was given — so the property is the one thing the two agree on, and the walk
 * up the parent chain is what stands in for the browser's own inheritance.
 * That a browser additionally refuses focus to everything found here is the
 * browser's doing: what a live stand has to settle is that the ring's edge and
 * the gate's own trap hold the keyboard between them without help from this
 * file.
 */
export function isInert(element: HTMLElement): boolean {
  for (
    let node: HTMLElement | null = element;
    node !== null;
    node = node.parentElement
  ) {
    if (node.inert) return true;
  }
  return false;
}

/**
 * Whether a closed fold keeps this element off the Tab path: it stands inside a
 * `<details>` whose body the page has not opened.
 *
 * The fold's own `summary` stays on the path — it is the control the reader uses
 * to open the block — while everything under a closed fold is not. A collapsed
 * system notice of the transcript is that body: it is rendered markdown, and
 * markdown paints its source chips as buttons, which a browser never stops on
 * until the reader opens the fold. Nested folds are read the same way, so the
 * walk gives its answer at the first closed one.
 */
function isFolded(element: HTMLElement): boolean {
  for (
    let node: HTMLElement | null = element.parentElement;
    node !== null;
    node = node.parentElement
  ) {
    if (!(node instanceof HTMLDetailsElement)) continue;
    if (element.tagName === "SUMMARY" && element.parentElement === node) {
      continue;
    }
    if (!node.open) return true;
  }
  return false;
}

/**
 * Every control of `root` the keyboard can still reach, in DOM order: what the
 * page has not hidden, what still carries a place in the tab order, what no
 * `inert` ancestor has handed to a dialog, and what no closed fold keeps out of
 * sight.
 */
export function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABABLE_SELECTOR)].filter(
    (element) =>
      !isHidden(element) &&
      !isTabbedOut(element) &&
      !isInert(element) &&
      !isFolded(element),
  );
}

/**
 * Hand the keyboard to the first candidate that takes it.
 *
 * What `focusable` reads is the markup, and a page can take a control off the
 * Tab path by other means: the chat rail and the sidebar of the surface are
 * switched off by a media query (`styles.ts`), and a browser stops on a
 * `display:none` control no more than on a `hidden` one. Neither this file nor a
 * test can see that — jsdom applies no CSS, and a stand at a wide panel has no
 * such control to trip over — so each candidate is checked at the moment it is
 * asked: a control that leaves `document.activeElement` where it was is passed
 * over, instead of leaving the reader on the same control they pressed Tab from.
 */
export function focusFirst(
  candidates: readonly (HTMLElement | null | undefined)[],
): void {
  for (const element of candidates) {
    if (element === null || element === undefined) continue;
    element.focus();
    if (document.activeElement === element) return;
  }
}

/**
 * The Tab ring over the roots a surface owns, in the order it walks them.
 *
 * A root under a modal gate contributes nothing: none of its controls can take
 * focus, so an edge of the ring that pointed into one would be a key the page
 * had already swallowed with nowhere to go — a Tab that sticks.
 */
export function focusRing(
  roots: readonly (HTMLElement | null)[],
): HTMLElement[] {
  return roots
    .filter((root): root is HTMLElement => root !== null && !isInert(root))
    .flatMap((root) => focusable(root));
}

/**
 * Keep Tab inside the ring the surface painted, and let the reader out at
 * neither edge.
 *
 * The ring is wider than `<main>`: a notice stack the surface paints in
 * `document.body` sits after it in the page, so a Tab leaving the composer
 * walks into the stack, and the edge where the key is caught and turned back is
 * the stack's last button — not the last control inside `<main>`, which is where
 * the ring used to stop the reader short of the notice. A key typed inside such
 * a portal is trapped by the handler mounted on the portal: the `<main>` above
 * it is not its ancestor and never hears the key.
 *
 * A ring with no controls in it answers nothing: there is nothing here to keep
 * the reader inside, and a key prevented with nowhere to hand the focus is a key
 * that sticks.
 */
export function trapKeys(
  event: KeyboardEvent<HTMLElement>,
  roots: readonly (HTMLElement | null)[],
): void {
  event.stopPropagation();
  if (event.key !== "Tab") return;
  const items = focusRing(roots);
  const first = items[0];
  const last = items.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    // The reader stands on the front of the ring and asks for what comes before
    // it: the back edge, then whatever stands in front of that edge, since the
    // edge itself may be a control this width has switched off.
    focusFirst([...items].reverse());
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    focusFirst(items);
  }
}
