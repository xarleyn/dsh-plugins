import type { KeyboardEvent } from "react";

/**
 * The tags and states a browser may give a place on the Tab path. What the page
 * has since taken away is read by `focusable`, one condition per function below.
 */
const TABABLE_SELECTOR =
  "button:not([disabled]), textarea:not([disabled]), a[href], input:not([disabled]), [tabindex]";

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
 * Every control of `root` the keyboard can still reach, in DOM order: what the
 * page has not hidden, what still carries a place in the tab order, and what no
 * `inert` ancestor has handed to a dialog.
 */
export function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABABLE_SELECTOR)].filter(
    (element) =>
      !isHidden(element) && !isTabbedOut(element) && !isInert(element),
  );
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
 */
export function trapKeys(
  event: KeyboardEvent<HTMLElement>,
  roots: readonly (HTMLElement | null)[],
): void {
  event.stopPropagation();
  if (event.key !== "Tab") return;
  const items = focusRing(roots);
  if (items.length === 0) {
    event.preventDefault();
    event.currentTarget.focus();
    return;
  }
  const first = items[0];
  const last = items.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
